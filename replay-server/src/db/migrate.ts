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
  },
  {
    id: 'ticket_issue_meta_fields',
    sql: `
      ALTER TABLE tickets ADD COLUMN issue_type TEXT;
      ALTER TABLE tickets ADD COLUMN impact_level TEXT CHECK(impact_level IS NULL OR impact_level IN ('low', 'medium', 'high', 'critical'));
      ALTER TABLE tickets ADD COLUMN occurred_start_at TEXT;
      ALTER TABLE tickets ADD COLUMN occurred_end_at TEXT;
    `
  },
  {
    id: 'ticket_status_expansion',
    sql: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE tickets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_no TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        reporter_id INTEGER NOT NULL,
        assignee_id INTEGER,
        site_id INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending_analysis', 'analyzing', 'pending_field_troubleshooting', 'field_troubleshooting', 'self_solved', 'pending_rd', 'rd_working', 'resolved')),
        issue_type TEXT,
        impact_level TEXT CHECK(impact_level IS NULL OR impact_level IN ('low', 'medium', 'high', 'critical')),
        occurred_start_at TEXT,
        occurred_end_at TEXT,
        self_service_result TEXT,
        self_service_note TEXT,
        escalation_reason TEXT,
        guide_feedback TEXT,
        conclusion TEXT,
        report_path TEXT,
        package_path TEXT,
        log_dir TEXT NOT NULL,
        map_dir TEXT,
        map_file TEXT,
        ai_enabled INTEGER NOT NULL DEFAULT 0,
        ai_conclusion TEXT,
        ai_offline INTEGER,
        latest_analysis_version_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        FOREIGN KEY (reporter_id) REFERENCES users(id),
        FOREIGN KEY (assignee_id) REFERENCES users(id),
        FOREIGN KEY (site_id) REFERENCES sites(id)
      );

      INSERT INTO tickets_new (
        id, ticket_no, title, description, reporter_id, assignee_id, site_id, status,
        issue_type, impact_level, occurred_start_at, occurred_end_at,
        self_service_result, self_service_note, escalation_reason, guide_feedback,
        conclusion, report_path, package_path, log_dir, map_dir, map_file,
        ai_enabled, ai_conclusion, ai_offline, latest_analysis_version_id, created_at, updated_at, resolved_at
      )
      SELECT
        id, ticket_no, title, description, reporter_id, assignee_id, site_id,
        CASE status
          WHEN 'analyzed' THEN 'pending_field_troubleshooting'
          WHEN 'verifying' THEN 'rd_working'
          WHEN 'needs_rd' THEN 'pending_rd'
          ELSE status
        END,
        issue_type, impact_level, occurred_start_at, occurred_end_at,
        self_service_result, self_service_note, escalation_reason, guide_feedback,
        conclusion, report_path, package_path, log_dir, map_dir, map_file,
        ai_enabled, ai_conclusion, ai_offline, latest_analysis_version_id, created_at, updated_at, resolved_at
      FROM tickets;

      DROP TABLE tickets;
      ALTER TABLE tickets_new RENAME TO tickets;

      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
      CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON tickets(reporter_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_site ON tickets(site_id);

      PRAGMA foreign_keys = ON;
    `
  },
  {
    id: 'create_analysis_versions_table',
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_analysis_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        version_no INTEGER NOT NULL,
        input_log_dir TEXT NOT NULL,
        input_map_dir TEXT,
        input_map_file TEXT,
        input_package_source TEXT,
        occurred_start_at TEXT,
        occurred_end_at TEXT,
        issue_type TEXT,
        top_issues TEXT NOT NULL,
        troubleshooting_paths_snapshot TEXT,
        evidence_summary TEXT,
        report_path TEXT,
        package_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id),
        UNIQUE(ticket_id, version_no)
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_versions_ticket ON ticket_analysis_versions(ticket_id);
    `
  },
  {
    id: 'ticket_latest_analysis_version',
    sql: `
      ALTER TABLE tickets ADD COLUMN latest_analysis_version_id INTEGER;
    `
  },
  {
    id: 'create_troubleshooting_paths_steps_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_troubleshooting_paths (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        analysis_version_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        title TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        severity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id),
        FOREIGN KEY (analysis_version_id) REFERENCES ticket_analysis_versions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_troubleshooting_paths_ticket ON ticket_troubleshooting_paths(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_troubleshooting_paths_version ON ticket_troubleshooting_paths(analysis_version_id);

      CREATE TABLE IF NOT EXISTS ticket_troubleshooting_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path_id INTEGER NOT NULL,
        step_no INTEGER NOT NULL,
        title TEXT NOT NULL,
        instruction TEXT,
        criteria TEXT,
        step_type TEXT NOT NULL,
        estimated_time TEXT,
        evidence_config TEXT,
        is_critical INTEGER NOT NULL DEFAULT 0,
        failure_action TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (path_id) REFERENCES ticket_troubleshooting_paths(id)
      );
      CREATE INDEX IF NOT EXISTS idx_troubleshooting_steps_path ON ticket_troubleshooting_steps(path_id);

      CREATE TABLE IF NOT EXISTS ticket_step_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        analysis_version_id INTEGER NOT NULL,
        path_id INTEGER NOT NULL,
        step_id INTEGER NOT NULL,
        actor_id INTEGER,
        action TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id),
        FOREIGN KEY (analysis_version_id) REFERENCES ticket_analysis_versions(id),
        FOREIGN KEY (path_id) REFERENCES ticket_troubleshooting_paths(id),
        FOREIGN KEY (step_id) REFERENCES ticket_troubleshooting_steps(id),
        FOREIGN KEY (actor_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_step_events_ticket ON ticket_step_events(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_step_events_step ON ticket_step_events(step_id);
    `
  },
  {
    id: 'create_step_events_table',
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_step_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        analysis_version_id INTEGER NOT NULL,
        path_id INTEGER NOT NULL,
        step_id INTEGER NOT NULL,
        actor_id INTEGER,
        action TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id),
        FOREIGN KEY (analysis_version_id) REFERENCES ticket_analysis_versions(id),
        FOREIGN KEY (path_id) REFERENCES ticket_troubleshooting_paths(id),
        FOREIGN KEY (step_id) REFERENCES ticket_troubleshooting_steps(id),
        FOREIGN KEY (actor_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_step_events_ticket ON ticket_step_events(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_step_events_step ON ticket_step_events(step_id);
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
    if (migration.id === 'ticket_issue_meta_fields' && columnExists(db, 'tickets', 'issue_type')) {
      continue;
    }
    if (migration.id === 'ticket_status_expansion') {
      const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'").get() as { sql: string } | undefined;
      if (createSql && createSql.sql.includes('pending_field_troubleshooting')) {
        continue;
      }
    }
    if (migration.id === 'create_analysis_versions_table' && tableExists(db, 'ticket_analysis_versions')) {
      continue;
    }
    if (migration.id === 'ticket_latest_analysis_version' && columnExists(db, 'tickets', 'latest_analysis_version_id')) {
      continue;
    }
    if (migration.id === 'create_troubleshooting_paths_steps_tables' && tableExists(db, 'ticket_troubleshooting_paths')) {
      continue;
    }
    if (migration.id === 'create_step_events_table' && tableExists(db, 'ticket_step_events')) {
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
