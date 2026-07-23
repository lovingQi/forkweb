import { getDb } from './index';

export interface DbVehicleCategory {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export async function createCategory(name: string): Promise<DbVehicleCategory> {
  const db = await getDb();
  const result = db.prepare('INSERT INTO vehicle_categories (name) VALUES (?)').run(name.trim());
  return getCategoryById(Number(result.lastInsertRowid)) as Promise<DbVehicleCategory>;
}

export async function getCategoryById(id: number): Promise<DbVehicleCategory | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM vehicle_categories WHERE id = ?').get(id) as DbVehicleCategory | undefined;
}

export async function listCategories(): Promise<DbVehicleCategory[]> {
  const db = await getDb();
  return db.prepare('SELECT * FROM vehicle_categories ORDER BY name ASC').all() as DbVehicleCategory[];
}

export async function updateCategory(id: number, name: string): Promise<DbVehicleCategory | undefined> {
  const db = await getDb();
  db.prepare("UPDATE vehicle_categories SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), id);
  return getCategoryById(id);
}

export async function deleteCategory(id: number): Promise<{ deleted: boolean; reason?: string }> {
  const db = await getDb();
  const modelCount = (db.prepare('SELECT COUNT(*) as c FROM vehicle_models WHERE category_id = ?').get(id) as { c: number }).c;
  if (modelCount > 0) {
    return { deleted: false, reason: '该类别下仍有型号，无法删除' };
  }
  const result = db.prepare('DELETE FROM vehicle_categories WHERE id = ?').run(id);
  return { deleted: result.changes > 0 };
}
