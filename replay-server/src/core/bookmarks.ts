import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { CACHE_DIR } from '../paths'
import type { ReplayBookmark } from '../types'

const BOOKMARK_FILE = path.join(CACHE_DIR, 'bookmarks.json')

export async function readBookmarks(): Promise<ReplayBookmark[]> {
  try {
    const text = await fs.readFile(BOOKMARK_FILE, 'utf8')
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function addBookmark(input: Omit<ReplayBookmark, 'id' | 'createdAt'> & { id?: string }): Promise<ReplayBookmark> {
  const bookmarks = await readBookmarks()
  const bookmark: ReplayBookmark = {
    id: input.id || `bookmark-${randomUUID().slice(0, 8)}`,
    timeMs: input.timeMs,
    timestamp: input.timestamp,
    title: input.title,
    note: input.note,
    eventId: input.eventId,
    level: input.level,
    createdAt: new Date().toISOString()
  }
  bookmarks.push(bookmark)
  await writeBookmarks(bookmarks)
  return bookmark
}

export async function deleteBookmark(id: string): Promise<boolean> {
  const bookmarks = await readBookmarks()
  const next = bookmarks.filter((bookmark) => bookmark.id !== id)
  if (next.length === bookmarks.length) return false
  await writeBookmarks(next)
  return true
}

export async function writeBookmarks(bookmarks: ReplayBookmark[]): Promise<void> {
  await fs.mkdir(path.dirname(BOOKMARK_FILE), { recursive: true })
  await fs.writeFile(BOOKMARK_FILE, `${JSON.stringify(bookmarks, null, 2)}\n`, 'utf8')
}
