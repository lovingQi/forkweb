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

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
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
  site_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending_analysis', 'analyzing', 'pending_field_troubleshooting', 'field_troubleshooting', 'self_solved', 'pending_rd', 'rd_working', 'resolved', 'cancelled')),
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
CREATE INDEX IF NOT EXISTS idx_tickets_site ON tickets(site_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id);

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

CREATE TABLE IF NOT EXISTS json_stores (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
