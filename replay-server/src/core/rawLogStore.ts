import fs from 'fs/promises'
import path from 'path'
import { createReadStream, createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createInterface } from 'readline'
import { CACHE_DIR } from '../paths'
import { parseLogLine } from '../parser/logLine'
import type { IndexedLogLine, LogLineRef, ParsedLogLine } from '../types'

export const RAW_LINES_PREFIX = 'raw-lines-'

export function rawLinesFilePath(cacheKey: string): string {
  return path.join(CACHE_DIR, `${RAW_LINES_PREFIX}${cacheKey}.jsonl`)
}

export function rawLinesIndexPath(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, '.idx')
}

const RAW_INDEX_MAGIC = 'FWIX'
const RAW_INDEX_VERSION = 1
const RAW_INDEX_HEADER_BYTES = 16
const RAW_INDEX_CACHE_LIMIT = 2
const READ_CHUNK_BYTES = 4 * 1024 * 1024
const RESOLVE_GAP_BYTES = 64 * 1024

interface RawLineIndex {
  mtimeMs: number
  count: number
  times: Float64Array
  offsets: Float64Array
}

const rawLineIndexCache = new Map<string, RawLineIndex>()

function rememberRawLineIndex(filePath: string, index: RawLineIndex): void {
  if (rawLineIndexCache.has(filePath)) rawLineIndexCache.delete(filePath)
  rawLineIndexCache.set(filePath, index)
  while (rawLineIndexCache.size > RAW_INDEX_CACHE_LIMIT) {
    const oldest = rawLineIndexCache.keys().next().value
    if (oldest === undefined) break
    rawLineIndexCache.delete(oldest)
  }
}

function encodeRawLineIndex(times: Float64Array, offsets: Float64Array): Buffer {
  const count = times.length
  const buffer = Buffer.alloc(RAW_INDEX_HEADER_BYTES + (count + offsets.length) * 8)
  buffer.write(RAW_INDEX_MAGIC, 0, 'ascii')
  buffer.writeUInt32LE(RAW_INDEX_VERSION, 4)
  buffer.writeUInt32LE(count, 8)
  buffer.writeUInt32LE(0, 12)
  let pos = RAW_INDEX_HEADER_BYTES
  for (let i = 0; i < count; i++) {
    buffer.writeDoubleLE(times[i], pos)
    pos += 8
  }
  for (let i = 0; i < offsets.length; i++) {
    buffer.writeDoubleLE(offsets[i], pos)
    pos += 8
  }
  return buffer
}

async function writeRawLineIndex(idxPath: string, times: Float64Array, offsets: Float64Array): Promise<void> {
  const temporary = `${idxPath}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporary, encodeRawLineIndex(times, offsets))
    await fs.rename(temporary, idxPath)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

function decodeRawLineIndex(buffer: Buffer, fileSize: number): { count: number; times: Float64Array; offsets: Float64Array } | null {
  if (buffer.length < RAW_INDEX_HEADER_BYTES) return null
  if (buffer.toString('ascii', 0, 4) !== RAW_INDEX_MAGIC) return null
  if (buffer.readUInt32LE(4) !== RAW_INDEX_VERSION) return null
  const count = buffer.readUInt32LE(8)
  const expected = RAW_INDEX_HEADER_BYTES + (count + count + 1) * 8
  if (buffer.length < expected) return null
  const times = new Float64Array(count)
  const offsets = new Float64Array(count + 1)
  let pos = RAW_INDEX_HEADER_BYTES
  for (let i = 0; i < count; i++) {
    times[i] = buffer.readDoubleLE(pos)
    pos += 8
  }
  for (let i = 0; i < count + 1; i++) {
    offsets[i] = buffer.readDoubleLE(pos)
    pos += 8
  }
  if (offsets[count] !== fileSize) return null
  return { count, times, offsets }
}

async function readRawLineIndex(idxPath: string, fileSize: number): Promise<{ count: number; times: Float64Array; offsets: Float64Array } | null> {
  try {
    const buffer = await fs.readFile(idxPath)
    return decodeRawLineIndex(buffer, fileSize)
  } catch {
    return null
  }
}

async function rebuildRawLineIndex(jsonlPath: string, fileSize: number): Promise<{ count: number; times: Float64Array; offsets: Float64Array }> {
  const handle = await fs.open(jsonlPath, 'r')
  const times: number[] = []
  const offsets: number[] = []
  let pos = 0
  let carry = Buffer.alloc(0)
  try {
    while (pos < fileSize) {
      const toRead = Math.min(READ_CHUNK_BYTES, fileSize - pos)
      const buf = Buffer.alloc(toRead)
      await handle.read(buf, 0, toRead, pos)
      pos += toRead
      const data = carry.length ? Buffer.concat([carry, buf]) : buf
      const base = pos - data.length
      let start = 0
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 10) continue
        const lineBuf = data.subarray(start, i)
        if (lineBuf.length && lineBuf.toString('utf8').trim()) {
          const parsed = JSON.parse(lineBuf.toString('utf8')) as ParsedLogLine
          offsets.push(base + start)
          times.push(parsed.timeMs)
        }
        start = i + 1
      }
      carry = Buffer.from(data.subarray(start))
    }
  } finally {
    await handle.close()
  }
  offsets.push(fileSize)
  const index = { count: times.length, times: Float64Array.from(times), offsets: Float64Array.from(offsets) }
  await writeRawLineIndex(rawLinesIndexPath(jsonlPath), index.times, index.offsets)
  return index
}

export function formatRawLine(line: ParsedLogLine): string {
  const sourceLine = line.sourceLine ?? '?'
  return `${line.timestamp} ${line.module}: ${sourceLine} [${line.level}] : ${line.message}`
}

function toLogLineRef(line: IndexedLogLine): LogLineRef {
  return {
    globalIndex: line.globalIndex,
    timeMs: line.timeMs,
    timestamp: line.timestamp,
    file: line.file,
    line: line.line,
    module: line.module
  }
}

export class RawLogStore {
  private indexTimes: Float64Array | null = null
  private indexOffsets: Float64Array | null = null
  private indexedCount = 0

  constructor(
    public readonly filePath: string,
    public readonly count: number
  ) {}

  static async create(lines: ParsedLogLine[], filePath: string): Promise<RawLogStore> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${process.pid}.tmp`
    try {
      const source = Readable.from(
        (function* () {
          for (let i = 0; i < lines.length; i += 1000) {
            const chunk = lines.slice(i, i + 1000)
            yield chunk.map((line, idx) => JSON.stringify({ ...line, globalIndex: i + idx })).join('\n') + '\n'
          }
        })()
      )
      await pipeline(source, createWriteStream(temporary))
      await fs.rename(temporary, filePath)
      return new RawLogStore(filePath, lines.length)
    } catch (e) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw e
    }
  }

  static load(filePath: string): RawLogStore | null {
    return new RawLogStore(filePath, 0)
  }

  static async mergeFromFiles(
    files: string[],
    outPath: string,
    onLine?: (line: ParsedLogLine, registerRef: (ref: LogLineRef) => void) => void
  ): Promise<{ store: RawLogStore; refMap: Map<string, number> }> {
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    const temporary = `${outPath}.${process.pid}.tmp`
    const perFile: {
      file: string
      handle: fs.FileHandle
      entries: { timeMs: number; line: number; offset: number; length: number }[]
      tmpPath: string
    }[] = []
    const pendingRefs = new Map<string, LogLineRef[]>()
    const registerRef = (ref: LogLineRef) => {
      const key = `${ref.file}:${ref.line}`
      const arr = pendingRefs.get(key) || []
      arr.push(ref)
      pendingRefs.set(key, arr)
    }

    try {
      // 1. 每个文件解析后写入临时 JSONL，并记录 (timeMs, line, offset, length)
      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]
        const tmpPath = `${temporary}.${fileIndex}.part`
        const entries: { timeMs: number; line: number; offset: number; length: number }[] = []
        let offset = 0
        const source = Readable.from(
          (async function* () {
            for await (const line of streamLogLines(file)) {
              onLine?.(line, registerRef)
              const json = `${JSON.stringify(line)}\n`
              const length = Buffer.byteLength(json)
              entries.push({ timeMs: line.timeMs, line: line.line, offset, length })
              offset += length
              yield Buffer.from(json)
            }
          })()
        )
        await pipeline(source, createWriteStream(tmpPath))
        entries.sort((a, b) => a.timeMs - b.timeMs || a.line - b.line)
        const handle = await fs.open(tmpPath, 'r')
        perFile.push({ file, handle, entries, tmpPath })
      }

      // 2. k 路归并写入全局 JSONL
      const out = createWriteStream(temporary)
      let globalIndex = 0
      let byteOffset = 0
      const totalLines = perFile.reduce((sum, file) => sum + file.entries.length, 0)
      const indexTimes = new Float64Array(totalLines)
      const indexOffsets = new Float64Array(totalLines + 1)
      const refMap = new Map<string, number>()
      type HeapNode = { timeMs: number; line: number; fileIndex: number; entryIndex: number }
      const heap: HeapNode[] = []
      for (let i = 0; i < perFile.length; i++) {
        if (perFile[i].entries.length > 0) {
          const e = perFile[i].entries[0]
          heap.push({ timeMs: e.timeMs, line: e.line, fileIndex: i, entryIndex: 0 })
        }
      }
      heapify(heap)

      while (heap.length > 0) {
        const node = heapPop(heap)
        const pf = perFile[node.fileIndex]
        const entry = pf.entries[node.entryIndex]
        const buf = Buffer.alloc(entry.length)
        await pf.handle.read(buf, 0, entry.length, entry.offset)
        const line = JSON.parse(buf.toString('utf8')) as ParsedLogLine
        const key = `${line.file}:${line.line}`
        const refs = pendingRefs.get(key)
        if (refs) {
          for (const ref of refs) {
            ref.globalIndex = globalIndex
            ref.timeMs = line.timeMs
            ref.timestamp = line.timestamp
          }
        }
        refMap.set(key, globalIndex)
        const payload = Buffer.from(`${JSON.stringify({ ...line, globalIndex })}\n`)
        indexOffsets[globalIndex] = byteOffset
        indexTimes[globalIndex] = line.timeMs
        byteOffset += payload.length
        globalIndex++
        out.write(payload)
        if (node.entryIndex + 1 < pf.entries.length) {
          const next = pf.entries[node.entryIndex + 1]
          heapPush(heap, { timeMs: next.timeMs, line: next.line, fileIndex: node.fileIndex, entryIndex: node.entryIndex + 1 })
        }
      }

      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve())
        out.on('error', reject)
      })

      indexOffsets[globalIndex] = byteOffset
      await fs.rename(temporary, outPath)
      await writeRawLineIndex(rawLinesIndexPath(outPath), indexTimes.subarray(0, globalIndex), indexOffsets.subarray(0, globalIndex + 1))

      // 3. 关闭 fd 并清理临时文件
      for (const pf of perFile) {
        await pf.handle.close().catch(() => undefined)
        await fs.rm(pf.tmpPath, { force: true }).catch(() => undefined)
      }

      return { store: new RawLogStore(outPath, globalIndex), refMap }
    } catch (e) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      for (const pf of perFile) {
        await pf.handle?.close().catch(() => undefined)
        await fs.rm(pf.tmpPath, { force: true }).catch(() => undefined)
      }
      throw e
    }
  }

  async getCount(): Promise<number> {
    if (this.count > 0) return this.count
    await this.ensureIndex()
    return this.indexedCount
  }

  async *streamLines(): AsyncGenerator<IndexedLogLine> {
    if (!(await fileExists(this.filePath))) return
    const rl = createInterface({
      input: createReadStream(this.filePath),
      crlfDelay: Infinity
    })
    let globalIndex = 0
    for await (const row of rl) {
      if (!row.trim()) continue
      try {
        yield { ...JSON.parse(row), globalIndex: globalIndex++ } as IndexedLogLine
      } catch {
        // 跳过损坏行
      }
    }
  }

  async *streamMatchingLines(rowTest: (row: string) => boolean): AsyncGenerator<IndexedLogLine> {
    if (!(await fileExists(this.filePath))) return
    const rl = createInterface({
      input: createReadStream(this.filePath),
      crlfDelay: Infinity
    })
    let globalIndex = 0
    for await (const row of rl) {
      if (!row.trim()) continue
      if (!rowTest(row)) {
        globalIndex++
        continue
      }
      try {
        yield { ...JSON.parse(row), globalIndex: globalIndex++ } as IndexedLogLine
      } catch {
        // 跳过损坏行
      }
    }
  }

  async readAll(): Promise<IndexedLogLine[]> {
    const lines: IndexedLogLine[] = []
    for await (const line of this.streamLines()) {
      lines.push(line)
    }
    return lines
  }

  async readSlice(start: number, end: number): Promise<IndexedLogLine[]> {
    await this.ensureIndex()
    const lo = Math.max(0, start)
    const hi = Math.min(this.indexedCount, end)
    if (lo >= hi || !this.indexOffsets) return []
    return readIndexedSlice(this.filePath, this.indexOffsets, lo, hi)
  }

  async readRange(startMs: number, endMs: number): Promise<IndexedLogLine[]> {
    const [lo, hi] = await this.findIndexRangeByTime(startMs, endMs)
    return this.readSlice(lo, hi)
  }

  async findIndexRangeByTime(startMs: number, endMs: number): Promise<[number, number]> {
    await this.ensureIndex()
    const times = this.indexTimes
    if (!times || this.indexedCount === 0) return [0, 0]
    const lo = lowerBound(times, this.indexedCount, startMs)
    const hi = upperBound(times, this.indexedCount, endMs)
    return [lo, hi]
  }

  async readFiltered(predicate: (line: IndexedLogLine) => boolean): Promise<IndexedLogLine[]> {
    const lines: IndexedLogLine[] = []
    for await (const line of this.streamLines()) {
      if (predicate(line)) lines.push(line)
    }
    return lines
  }

  async findNearestIndex(timeMs: number): Promise<number> {
    await this.ensureIndex()
    const times = this.indexTimes
    if (!times || this.indexedCount === 0) return 0
    const lo = lowerBound(times, this.indexedCount, timeMs)
    let best = Math.min(lo, this.indexedCount - 1)
    if (lo > 0) {
      const previousDelta = Math.abs(times[lo - 1] - timeMs)
      const nextDelta = lo < this.indexedCount ? Math.abs(times[lo] - timeMs) : Infinity
      best = previousDelta <= nextDelta ? lo - 1 : lo
    }
    return lowerBound(times, this.indexedCount, times[best])
  }

  async readAroundTime(timeMs: number, count: number): Promise<IndexedLogLine[]> {
    const nearestIndex = await this.findNearestIndex(timeMs)
    const half = Math.floor(count / 2)
    return this.readSlice(Math.max(0, nearestIndex - half), nearestIndex + half + 1)
  }

  async resolveRefs(refs: LogLineRef[]): Promise<IndexedLogLine[]> {
    if (refs.length === 0) return []
    const positions = new Map<number, number[]>()
    const result: (IndexedLogLine | undefined)[] = new Array(refs.length)
    refs.forEach((ref, i) => {
      if (ref.globalIndex < 0) {
        result[i] = fallbackRef(ref)
        return
      }
      const arr = positions.get(ref.globalIndex) || []
      arr.push(i)
      positions.set(ref.globalIndex, arr)
    })
    if (positions.size === 0) return refs.map((ref, i) => result[i] || fallbackRef(ref))
    await this.ensureIndex()
    const offsets = this.indexOffsets
    const sortedIndices = Array.from(positions.keys())
      .filter((index) => index >= 0 && index < this.indexedCount)
      .sort((a, b) => a - b)
    for (const index of Array.from(positions.keys())) {
      if (index < 0 || index >= this.indexedCount) {
        for (const pos of positions.get(index) || []) result[pos] = fallbackRef(refs[pos])
      }
    }
    if (sortedIndices.length > 0 && offsets) {
      const groups: Array<[number, number]> = []
      let groupStart = sortedIndices[0]
      let groupEnd = sortedIndices[0] + 1
      for (let i = 1; i < sortedIndices.length; i++) {
        const next = sortedIndices[i]
        if (offsets[next] - offsets[groupEnd] <= RESOLVE_GAP_BYTES) {
          groupEnd = next + 1
        } else {
          groups.push([groupStart, groupEnd])
          groupStart = next
          groupEnd = next + 1
        }
      }
      groups.push([groupStart, groupEnd])
      for (const [start, end] of groups) {
        const lines = await this.readSlice(start, end)
        for (const line of lines) {
          const positionsForLine = positions.get(line.globalIndex)
          if (!positionsForLine) continue
          for (const pos of positionsForLine) result[pos] = line
        }
      }
    }
    return refs.map((ref, i) => result[i] || fallbackRef(ref))
  }

  async dispose(): Promise<void> {
    await fs.rm(this.filePath, { force: true }).catch(() => undefined)
    await fs.rm(rawLinesIndexPath(this.filePath), { force: true }).catch(() => undefined)
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexTimes && this.indexOffsets) return
    const stat = await fs.stat(this.filePath)
    const cached = rawLineIndexCache.get(this.filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      this.indexTimes = cached.times
      this.indexOffsets = cached.offsets
      this.indexedCount = cached.count
      return
    }
    const loaded = await readRawLineIndex(rawLinesIndexPath(this.filePath), stat.size)
    const index = loaded ?? await rebuildRawLineIndex(this.filePath, stat.size)
    const stored = { mtimeMs: stat.mtimeMs, count: index.count, times: index.times, offsets: index.offsets }
    rememberRawLineIndex(this.filePath, stored)
    this.indexTimes = stored.times
    this.indexOffsets = stored.offsets
    this.indexedCount = stored.count
  }
}

function lowerBound(times: Float64Array, count: number, value: number): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBound(times: Float64Array, count: number, value: number): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

async function readIndexedSlice(filePath: string, offsets: Float64Array, lo: number, hi: number): Promise<IndexedLogLine[]> {
  const startOff = offsets[lo]
  const endOff = offsets[hi]
  const handle = await fs.open(filePath, 'r')
  const lines: IndexedLogLine[] = []
  let pos = startOff
  let carry = Buffer.alloc(0)
  let index = lo
  try {
    while (pos < endOff) {
      const toRead = Math.min(READ_CHUNK_BYTES, endOff - pos)
      const buf = Buffer.alloc(toRead)
      await handle.read(buf, 0, toRead, pos)
      pos += toRead
      const data = carry.length ? Buffer.concat([carry, buf]) : buf
      let start = 0
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 10) continue
        const lineBuf = data.subarray(start, i)
        if (lineBuf.length && lineBuf.toString('utf8').trim()) {
          const parsed = JSON.parse(lineBuf.toString('utf8')) as IndexedLogLine
          lines.push({ ...parsed, globalIndex: index++ })
        }
        start = i + 1
      }
      carry = Buffer.from(data.subarray(start))
    }
    if (carry.length && carry.toString('utf8').trim()) {
      const parsed = JSON.parse(carry.toString('utf8')) as IndexedLogLine
      lines.push({ ...parsed, globalIndex: index++ })
    }
  } finally {
    await handle.close()
  }
  return lines
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function* streamLogLines(file: string): AsyncGenerator<ParsedLogLine> {
  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity
  })
  let lineNumber = 0
  for await (const row of rl) {
    lineNumber++
    const line = parseLogLine(row, file, lineNumber)
    if (line) yield line
  }
}

function fallbackRef(ref: LogLineRef): IndexedLogLine {
  return {
    globalIndex: ref.globalIndex,
    file: ref.file,
    line: ref.line,
    timestamp: ref.timestamp,
    timeMs: ref.timeMs,
    module: 'unknown',
    sourceLine: null,
    level: 'I',
    message: `[日志引用失效: ${ref.file}:${ref.line}]`
  }
}

function heapify(heap: { timeMs: number; line: number; fileIndex: number; entryIndex: number }[]) {
  for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
    siftDown(heap, i)
  }
}

function heapPush(
  heap: { timeMs: number; line: number; fileIndex: number; entryIndex: number }[],
  node: { timeMs: number; line: number; fileIndex: number; entryIndex: number }
) {
  heap.push(node)
  let i = heap.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (compare(heap[p], heap[i]) <= 0) break
    ;[heap[p], heap[i]] = [heap[i], heap[p]]
    i = p
  }
}

function heapPop(heap: { timeMs: number; line: number; fileIndex: number; entryIndex: number }[]) {
  const top = heap[0]
  const last = heap.pop()!
  if (heap.length > 0) {
    heap[0] = last
    siftDown(heap, 0)
  }
  return top
}

function siftDown(
  heap: { timeMs: number; line: number; fileIndex: number; entryIndex: number }[],
  i: number
) {
  while (true) {
    const l = i * 2 + 1
    const r = l + 1
    let smallest = i
    if (l < heap.length && compare(heap[l], heap[smallest]) < 0) smallest = l
    if (r < heap.length && compare(heap[r], heap[smallest]) < 0) smallest = r
    if (smallest === i) break
    ;[heap[i], heap[smallest]] = [heap[smallest], heap[i]]
    i = smallest
  }
}

function compare(
  a: { timeMs: number; line: number; fileIndex: number; entryIndex: number },
  b: { timeMs: number; line: number; fileIndex: number; entryIndex: number }
): number {
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
  if (a.line !== b.line) return a.line - b.line
  return a.fileIndex - b.fileIndex
}
