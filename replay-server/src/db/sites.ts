import type Database from 'better-sqlite3';
import { getDb } from './index';

export interface DbSite {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSiteInput {
  name: string;
}

export async function createSite(input: CreateSiteInput): Promise<DbSite> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO sites (name) VALUES (?)`
  );
  const result = stmt.run(input.name.trim());
  return getSiteById(Number(result.lastInsertRowid)) as Promise<DbSite>;
}

export async function getSiteById(id: number): Promise<DbSite | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as DbSite | undefined;
}

export async function getSiteByName(name: string): Promise<DbSite | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM sites WHERE name = ?').get(name) as DbSite | undefined;
}

export async function listSites(): Promise<DbSite[]> {
  const db = await getDb();
  return db.prepare('SELECT * FROM sites ORDER BY name ASC').all() as DbSite[];
}

export async function updateSite(id: number, input: Partial<CreateSiteInput>): Promise<DbSite | undefined> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name.trim());
  }
  if (sets.length === 0) return getSiteById(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getSiteById(id);
}

export async function deleteSite(id: number): Promise<boolean> {
  const db = await getDb();
  const result = db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  return result.changes > 0;
}
