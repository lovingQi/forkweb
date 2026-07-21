import fs from 'fs/promises';
import path from 'path';
import type Database from 'better-sqlite3';
import { CACHE_DIR, CONFIG_DIR } from '../paths';

const MIGRATIONS = [
  {
    id: 'ticket_ai_fields',
    sql: `
      ALTER TABLE tickets ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tickets ADD COLUMN ai_conclusion TEXT;
      ALTER TABLE tickets ADD COLUMN ai_offline INTEGER;
    `
  },
  {
    id: 'user_disabled_field',
    sql: `
      ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    id: 'user_last_login_at',
    sql: `
      ALTER TABLE users ADD COLUMN last_login_at TEXT;
    `
  },
  {
    id: 'create_sites_table',
    sql: `
      CREATE TABLE IF NOT EXISTS sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `
  },
  {
    id: 'ticket_site_field',
    sql: `
      ALTER TABLE tickets ADD COLUMN site_id INTEGER REFERENCES sites(id);
    `
  }
];

const LEGACY_JSON_FILES: { key: string; path: string; wrap?: (data: unknown) => unknown }[] = [
  { key: 'bookmarks', path: path.join(CACHE_DIR, 'bookmarks.json') },
  { key: 'caseMeta', path: path.join(CACHE_DIR, 'case-meta.json') },
  { key: 'mapAliases', path: path.join(CONFIG_DIR, 'map-alias.json'), wrap: (data) => (data && typeof data === 'object' ? (data as any).aliases || [] : []) },
  { key: 'rootCauseFeedback', path: path.join(CACHE_DIR, 'root-cause-feedback.json') },
  { key: 'vectorStore', path: path.join(CACHE_DIR, 'vector-store.json') },
  { key: 'llmLocalConfig', path: path.join(CONFIG_DIR, 'llm.local.json') },
  { key: 'knowledgeBase', path: path.join(CONFIG_DIR, 'knowledge-base.json') },
  { key: 'knowledgeHits', path: path.join(CACHE_DIR, 'knowledge-hits.json') },
  { key: 'manualErrorDictionary', path: path.join(CONFIG_DIR, 'manual-error-dictionary.json') }
];

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined;
  return !!row;
}

function rowCount(db: Database.Database, table: string): number {
  if (!tableExists(db, table)) return 0;
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
  return row.c;
}

async function migrateLegacyJsonFiles(db: Database.Database): Promise<void> {
  if (!tableExists(db, 'json_stores')) return;
  if (rowCount(db, 'json_stores') > 0) return;

  const stmt = db.prepare(
    `INSERT INTO json_stores (key, payload, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  );

  for (const item of LEGACY_JSON_FILES) {
    try {
      const text = await fs.readFile(item.path, 'utf8');
      let data: unknown = JSON.parse(text);
      if (item.wrap) {
        data = item.wrap(data);
      }
      stmt.run(item.key, JSON.stringify(data));
      console.log(`[db] migrated legacy JSON to json_stores: ${item.key}`);
      // 迁移成功后重命名原文件，便于回滚
      await fs.rename(item.path, `${item.path}.bak`).catch(() => undefined);
    } catch (e) {
      // 文件不存在或解析失败，跳过
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[db] failed to migrate legacy JSON ${item.key}:`, e);
      }
    }
  }
}

export async function runMigrations(db: Database.Database): Promise<void> {
  for (const migration of MIGRATIONS) {
    if (migration.id === 'ticket_ai_fields' && columnExists(db, 'tickets', 'ai_enabled')) {
      continue;
    }
    if (migration.id === 'user_disabled_field' && columnExists(db, 'users', 'disabled')) {
      continue;
    }
    if (migration.id === 'user_last_login_at' && columnExists(db, 'users', 'last_login_at')) {
      continue;
    }
    if (migration.id === 'create_sites_table' && tableExists(db, 'sites')) {
      continue;
    }
    if (migration.id === 'ticket_site_field' && columnExists(db, 'tickets', 'site_id')) {
      continue;
    }
    try {
      db.exec(migration.sql);
      console.log(`[db] migration applied: ${migration.id}`);
    } catch (e) {
      console.error(`[db] migration failed: ${migration.id}`, e);
      throw e;
    }
  }

  await migrateLegacyJsonFiles(db);
}
