import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { CACHE_DIR } from '../paths';
import { SCHEMA_SQL } from './schema';
import { runMigrations } from './migrate';

const DB_DIR = CACHE_DIR;
const DB_FILE = path.join(DB_DIR, 'forkweb.db');

let db: Database.Database | null = null;

export async function getDb(): Promise<Database.Database> {
  if (db) return db;
  await fs.mkdir(DB_DIR, { recursive: true });
  db = new Database(DB_FILE);
  db.exec(SCHEMA_SQL);
  await runMigrations(db);
  db.pragma('journal_mode = WAL');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
