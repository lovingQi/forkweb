import type Database from 'better-sqlite3';

const MIGRATIONS = [
  {
    id: 'ticket_ai_fields',
    sql: `
      ALTER TABLE tickets ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tickets ADD COLUMN ai_conclusion TEXT;
      ALTER TABLE tickets ADD COLUMN ai_offline INTEGER;
    `
  }
];

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export function runMigrations(db: Database.Database): void {
  for (const migration of MIGRATIONS) {
    if (migration.id === 'ticket_ai_fields' && columnExists(db, 'tickets', 'ai_enabled')) {
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
}
