import { getDb } from './index';

export async function readJsonStore<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const row = db.prepare('SELECT payload FROM json_stores WHERE key = ?').get(key) as { payload: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonStore<T>(key: string, payload: T): Promise<void> {
  const db = await getDb();
  const text = JSON.stringify(payload);
  db.prepare(
    `INSERT INTO json_stores (key, payload, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(key, text);
}

export async function deleteJsonStore(key: string): Promise<void> {
  const db = await getDb();
  db.prepare('DELETE FROM json_stores WHERE key = ?').run(key);
}
