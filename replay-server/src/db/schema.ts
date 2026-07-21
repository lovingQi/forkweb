export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('after_sales', 'rd', 'admin')),
  display_name TEXT,
  email TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reporter_id INTEGER NOT NULL,
  assignee_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending_analysis', 'analyzing', 'analyzed', 'verifying', 'resolved', 'needs_rd')),
  conclusion TEXT,
  report_path TEXT,
  package_path TEXT,
  log_dir TEXT NOT NULL,
  map_dir TEXT,
  map_file TEXT,
  ai_enabled INTEGER NOT NULL DEFAULT 0,
  ai_conclusion TEXT,
  ai_offline INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (reporter_id) REFERENCES users(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON tickets(reporter_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id);

CREATE TABLE IF NOT EXISTS json_stores (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
