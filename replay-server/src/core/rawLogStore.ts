import fs from 'fs/promises'
import path from 'path'
import { createReadStream, createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createInterface } from 'readline'
import { CACHE_DIR } from '../paths'
import type { ParsedLogLine } from '../types'

export const RAW_LINES_PREFIX = 'raw-lines-'

export function rawLinesFilePath(cacheKey: string): string {
  return path.join(CACHE_DIR, `${RAW_LINES_PREFIX}${cacheKey}.jsonl`)
}

export function formatRawLine(line: ParsedLogLine): string {
  const sourceLine = line.sourceLine ?? '?'
  return `${line.timestamp} ${line.module}: ${sourceLine} [${line.level}] : ${line.message}`
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
            yield chunk.map((line) => JSON.stringify(line)).join('\n') + '\n'
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

  async getCount(): Promise<number> {
    if (this.count > 0) return this.count
    let count = 0
    for await (const _ of this.streamLines()) {
      count++
    }
    return count
  }

  async *streamLines(): AsyncGenerator<ParsedLogLine> {
    if (!(await fileExists(this.filePath))) return
    const rl = createInterface({
      input: createReadStream(this.filePath),
      crlfDelay: Infinity
    })
    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        yield JSON.parse(line) as ParsedLogLine
      } catch {
        // 跳过损坏行
      }
    }
  }

  async readAll(): Promise<ParsedLogLine[]> {
    const lines: ParsedLogLine[] = []
    for await (const line of this.streamLines()) {
      lines.push(line)
    }
    return lines
  }

  async readSlice(start: number, end: number): Promise<ParsedLogLine[]> {
    const lines: ParsedLogLine[] = []
    let index = 0
    for await (const line of this.streamLines()) {
      if (index >= end) break
      if (index >= start) lines.push(line)
      index++
    }
    return lines
  }

  async readRange(startMs: number, endMs: number): Promise<ParsedLogLine[]> {
    const lines: ParsedLogLine[] = []
    for await (const line of this.streamLines()) {
      if (line.timeMs >= startMs && line.timeMs <= endMs) lines.push(line)
    }
    return lines
  }

  async readFiltered(predicate: (line: ParsedLogLine) => boolean): Promise<ParsedLogLine[]> {
    const lines: ParsedLogLine[] = []
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

  async readAroundTime(timeMs: number, count: number): Promise<ParsedLogLine[]> {
    const nearestIndex = await this.findNearestIndex(timeMs)
    const half = Math.floor(count / 2)
    return this.readSlice(Math.max(0, nearestIndex - half), nearestIndex + half + 1)
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
