import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { SCHEMA_SQL } from './schema';

const DB_DIR = path.resolve(process.cwd(), 'replay-server/.cache');
const DB_FILE = path.join(DB_DIR, 'forkweb.db');

let db: Database.Database | null = null;

export async function getDb(): Promise<Database.Database> {
  if (db) return db;
  await fs.mkdir(DB_DIR, { recursive: true });
  db = new Database(DB_FILE);
  db.exec(SCHEMA_SQL);
  db.pragma('journal_mode = WAL');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
