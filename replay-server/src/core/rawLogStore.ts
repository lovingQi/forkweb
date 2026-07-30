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
        out.write(`${JSON.stringify({ ...line, globalIndex: globalIndex++ })}\n`)
        if (node.entryIndex + 1 < pf.entries.length) {
          const next = pf.entries[node.entryIndex + 1]
          heapPush(heap, { timeMs: next.timeMs, line: next.line, fileIndex: node.fileIndex, entryIndex: node.entryIndex + 1 })
        }
      }

      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve())
        out.on('error', reject)
      })

      await fs.rename(temporary, outPath)

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
    let count = 0
    for await (const _ of this.streamLines()) {
      count++
    }
    return count
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

  async readAll(): Promise<IndexedLogLine[]> {
    const lines: IndexedLogLine[] = []
    for await (const line of this.streamLines()) {
      lines.push(line)
    }
    return lines
  }

  async readSlice(start: number, end: number): Promise<IndexedLogLine[]> {
    const lines: IndexedLogLine[] = []
    let index = 0
    for await (const line of this.streamLines()) {
      if (index >= end) break
      if (index >= start) lines.push(line)
      index++
    }
    return lines
  }

  async readRange(startMs: number, endMs: number): Promise<IndexedLogLine[]> {
    const lines: IndexedLogLine[] = []
    for await (const line of this.streamLines()) {
      if (line.timeMs >= startMs && line.timeMs <= endMs) lines.push(line)
    }
    return lines
  }

  async readFiltered(predicate: (line: IndexedLogLine) => boolean): Promise<IndexedLogLine[]> {
    const lines: IndexedLogLine[] = []
    for await (const line of this.streamLines()) {
      if (predicate(line)) lines.push(line)
    }
    return lines
  }

  async findNearestIndex(timeMs: number): Promise<number> {
    let nearestIndex = 0
    let index = 0
    let minDelta = Infinity
    for await (const line of this.streamLines()) {
      const delta = Math.abs(line.timeMs - timeMs)
      if (delta < minDelta) {
        minDelta = delta
        nearestIndex = index
      }
      index++
    }
    return nearestIndex
  }

  async readAroundTime(timeMs: number, count: number): Promise<IndexedLogLine[]> {
    const nearestIndex = await this.findNearestIndex(timeMs)
    const half = Math.floor(count / 2)
    return this.readSlice(Math.max(0, nearestIndex - half), nearestIndex + half + 1)
  }

  async resolveRefs(refs: LogLineRef[]): Promise<ParsedLogLine[]> {
    if (refs.length === 0) return []
    const positions = new Map<number, number[]>()
    refs.forEach((ref, i) => {
      const arr = positions.get(ref.globalIndex) || []
      arr.push(i)
      positions.set(ref.globalIndex, arr)
    })
    const sortedIndices = Array.from(positions.keys()).sort((a, b) => a - b)
    const result: (ParsedLogLine | undefined)[] = new Array(refs.length)
    let nextIdx = 0
    for await (const line of this.streamLines()) {
      if (nextIdx >= sortedIndices.length) break
      if (line.globalIndex === sortedIndices[nextIdx]) {
        const plain: ParsedLogLine = {
          file: line.file,
          line: line.line,
          timestamp: line.timestamp,
          timeMs: line.timeMs,
          module: line.module,
          sourceLine: line.sourceLine,
          level: line.level,
          message: line.message
        }
        for (const pos of positions.get(line.globalIndex)!) {
          result[pos] = plain
        }
        nextIdx++
      }
    }
    return refs.map((ref, i) => result[i] || fallbackRef(ref))
  }

  async dispose(): Promise<void> {
    await fs.rm(this.filePath, { force: true }).catch(() => undefined)
  }
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

function fallbackRef(ref: LogLineRef): ParsedLogLine {
  return {
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
