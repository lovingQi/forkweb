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
  db.prepare('DELETE FROM site_vehicle_models WHERE site_id = ?').run(id);
  const result = db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function setSiteVehicleModels(siteId: number, modelIds: number[]): Promise<void> {
  const db = await getDb();
  db.prepare('DELETE FROM site_vehicle_models WHERE site_id = ?').run(siteId);
  const stmt = db.prepare('INSERT INTO site_vehicle_models (site_id, vehicle_model_id) VALUES (?, ?)');
  for (const modelId of modelIds) {
    stmt.run(siteId, modelId);
  }
}

export async function getSiteVehicleModelIds(siteId: number): Promise<number[]> {
  const db = await getDb();
  const rows = db.prepare('SELECT vehicle_model_id FROM site_vehicle_models WHERE site_id = ?').all(siteId) as Array<{ vehicle_model_id: number }>;
  return rows.map((r) => r.vehicle_model_id);
}
