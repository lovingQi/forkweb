import { randomUUID } from 'crypto'
import { readJsonStore, writeJsonStore } from '../db/jsonStore'
import type { ReplayBookmark } from '../types'

const KEY = 'bookmarks'

export async function readBookmarks(): Promise<ReplayBookmark[]> {
  return readJsonStore<ReplayBookmark[]>(KEY, [])
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
  await writeJsonStore(KEY, bookmarks)
  return bookmark
}

export async function deleteBookmark(id: string): Promise<boolean> {
  const bookmarks = await readBookmarks()
  const next = bookmarks.filter((bookmark) => bookmark.id !== id)
  if (next.length === bookmarks.length) return false
  await writeJsonStore(KEY, next)
  return true
}

export async function writeBookmarks(bookmarks: ReplayBookmark[]): Promise<void> {
  await writeJsonStore(KEY, bookmarks)
}
