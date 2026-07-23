import { getDb } from './index';

export interface DbVehicleModel {
  id: number;
  category_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DbVehicleModelWithCategory extends DbVehicleModel {
  category_name: string;
}

export async function createModel(categoryId: number, name: string): Promise<DbVehicleModel> {
  const db = await getDb();
  const result = db.prepare('INSERT INTO vehicle_models (category_id, name) VALUES (?, ?)').run(categoryId, name.trim());
  return getModelById(Number(result.lastInsertRowid)) as Promise<DbVehicleModel>;
}

export async function getModelById(id: number): Promise<DbVehicleModelWithCategory | undefined> {
  const db = await getDb();
  return db.prepare(`
    SELECT vm.*, vc.name as category_name
    FROM vehicle_models vm
    JOIN vehicle_categories vc ON vm.category_id = vc.id
    WHERE vm.id = ?
  `).get(id) as DbVehicleModelWithCategory | undefined;
}

export async function listModelsByCategoryId(categoryId: number): Promise<DbVehicleModel[]> {
  const db = await getDb();
  return db.prepare('SELECT * FROM vehicle_models WHERE category_id = ? ORDER BY name ASC').all(categoryId) as DbVehicleModel[];
}

export async function listAllModels(): Promise<DbVehicleModelWithCategory[]> {
  const db = await getDb();
  return db.prepare(`
    SELECT vm.*, vc.name as category_name
    FROM vehicle_models vm
    JOIN vehicle_categories vc ON vm.category_id = vc.id
    ORDER BY vc.name ASC, vm.name ASC
  `).all() as DbVehicleModelWithCategory[];
}

export async function updateModel(id: number, name: string): Promise<DbVehicleModel | undefined> {
  const db = await getDb();
  db.prepare("UPDATE vehicle_models SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), id);
  return getModelById(id);
}

export async function deleteModel(id: number): Promise<{ deleted: boolean; reason?: string }> {
  const db = await getDb();
  const siteCount = (db.prepare('SELECT COUNT(*) as c FROM site_vehicle_models WHERE vehicle_model_id = ?').get(id) as { c: number }).c;
  if (siteCount > 0) {
    return { deleted: false, reason: '该型号已被现场关联，无法删除' };
  }
  const ticketCount = (db.prepare('SELECT COUNT(*) as c FROM tickets WHERE vehicle_model_id = ?').get(id) as { c: number }).c;
  if (ticketCount > 0) {
    return { deleted: false, reason: '该型号已被工单关联，无法删除' };
  }
  const result = db.prepare('DELETE FROM vehicle_models WHERE id = ?').run(id);
  return { deleted: result.changes > 0 };
}

export async function listModelsBySiteId(siteId: number): Promise<DbVehicleModelWithCategory[]> {
  const db = await getDb();
  return db.prepare(`
    SELECT vm.*, vc.name as category_name
    FROM vehicle_models vm
    JOIN vehicle_categories vc ON vm.category_id = vc.id
    JOIN site_vehicle_models svm ON svm.vehicle_model_id = vm.id
    WHERE svm.site_id = ?
    ORDER BY vc.name ASC, vm.name ASC
  `).all(siteId) as DbVehicleModelWithCategory[];
}
