import { getDb } from './index';

export type TicketStatus =
  | 'pending_analysis'
  | 'analyzing'
  | 'pending_field_troubleshooting'
  | 'field_troubleshooting'
  | 'self_solved'
  | 'pending_rd'
  | 'rd_working'
  | 'resolved';

export interface DbTicket {
  id: number;
  ticket_no: string;
  title: string;
  description: string;
  reporter_id: number;
  assignee_id: number | null;
  site_id: number | null;
  status: TicketStatus;
  issue_type: string | null;
  impact_level: string | null;
  occurred_start_at: string | null;
  occurred_end_at: string | null;
  self_service_result: string | null;
  self_service_note: string | null;
  escalation_reason: string | null;
  guide_feedback: string | null;
  conclusion: string | null;
  report_path: string | null;
  package_path: string | null;
  log_dir: string;
  map_dir: string | null;
  map_file: string | null;
  ai_enabled: number;
  ai_conclusion: string | null;
  ai_offline: number | null;
  latest_analysis_version_id: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface CreateTicketInput {
  ticketNo: string;
  title: string;
  description: string;
  reporterId: number;
  siteId?: number;
  issueType?: string;
  impactLevel?: string;
  occurredStartAt?: string;
  occurredEndAt?: string;
  logDir: string;
  mapDir?: string;
  mapFile?: string;
  aiEnabled?: boolean;
}

export async function createTicket(input: CreateTicketInput): Promise<DbTicket> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO tickets (ticket_no, title, description, reporter_id, site_id, status, issue_type, impact_level, occurred_start_at, occurred_end_at, log_dir, map_dir, map_file, ai_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.ticketNo,
    input.title,
    input.description,
    input.reporterId,
    input.siteId ?? null,
    'pending_analysis',
    input.issueType ?? null,
    input.impactLevel ?? null,
    input.occurredStartAt ?? null,
    input.occurredEndAt ?? null,
    input.logDir,
    input.mapDir || null,
    input.mapFile || null,
    input.aiEnabled ? 1 : 0
  );
  return getTicketById(Number(result.lastInsertRowid)) as Promise<DbTicket>;
}

export async function getTicketById(id: number): Promise<DbTicket | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as DbTicket | undefined;
}

export async function updateTicket(
  id: number,
  input: Partial<
    Pick<
      DbTicket,
      | 'status'
      | 'assignee_id'
      | 'issue_type'
      | 'impact_level'
      | 'occurred_start_at'
      | 'occurred_end_at'
      | 'self_service_result'
      | 'self_service_note'
      | 'escalation_reason'
      | 'guide_feedback'
      | 'conclusion'
      | 'report_path'
      | 'package_path'
      | 'log_dir'
      | 'map_dir'
      | 'map_file'
      | 'site_id'
      | 'ai_enabled'
      | 'ai_conclusion'
      | 'ai_offline'
      | 'latest_analysis_version_id'
      | 'resolved_at'
    >
  >
): Promise<DbTicket | undefined> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return getTicketById(id);

  if (input.status === 'resolved' && !input.resolved_at) {
    sets.push("resolved_at = datetime('now')");
  }
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getTicketById(id);
}

export interface TicketWithReporter extends DbTicket {
  reporter_username: string;
  site_name?: string;
}

export async function listTickets(filters?: {
  reporterId?: number;
  status?: TicketStatus | TicketStatus[];
  assigneeId?: number | null;
  issueType?: string;
  limit?: number;
  offset?: number;
}): Promise<DbTicket[]> {
  const db = await getDb();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters?.reporterId !== undefined) {
    where.push('reporter_id = ?');
    values.push(filters.reporterId);
  }
  if (filters?.status !== undefined) {
    if (Array.isArray(filters.status)) {
      where.push(`status IN (${filters.status.map(() => '?').join(', ')})`);
      values.push(...filters.status);
    } else {
      where.push('status = ?');
      values.push(filters.status);
    }
  }
  if (filters?.assigneeId !== undefined) {
    if (filters.assigneeId === null) {
      where.push('assignee_id IS NULL');
    } else {
      where.push('assignee_id = ?');
      values.push(filters.assigneeId);
    }
  }
  if (filters?.issueType !== undefined) {
    where.push('issue_type = ?');
    values.push(filters.issueType);
  }
  const sql =
    'SELECT * FROM tickets' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY updated_at DESC' +
    (filters?.limit ? ' LIMIT ?' : '') +
    (filters?.offset ? ' OFFSET ?' : '');
  if (filters?.limit) values.push(filters.limit);
  if (filters?.offset) values.push(filters.offset);
  return db.prepare(sql).all(...values) as DbTicket[];
}

export async function listTicketsWithAnalysisCompletedBefore(cutoff: string): Promise<DbTicket[]> {
  const db = await getDb();
  return db
    .prepare(
      `SELECT t.*
       FROM tickets t
       INNER JOIN ticket_analysis_versions v ON v.id = t.latest_analysis_version_id
       WHERE v.created_at < ?`
    )
    .all(cutoff) as DbTicket[];
}

export async function listTicketsWithReporter(filters?: {
  reporterId?: number;
  status?: TicketStatus | TicketStatus[];
  assigneeId?: number | null;
  siteId?: number;
  issueType?: string;
  limit?: number;
  offset?: number;
}): Promise<TicketWithReporter[]> {
  const db = await getDb();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters?.reporterId !== undefined) {
    where.push('t.reporter_id = ?');
    values.push(filters.reporterId);
  }
  if (filters?.status !== undefined) {
    if (Array.isArray(filters.status)) {
      where.push(`t.status IN (${filters.status.map(() => '?').join(', ')})`);
      values.push(...filters.status);
    } else {
      where.push('t.status = ?');
      values.push(filters.status);
    }
  }
  if (filters?.assigneeId !== undefined) {
    if (filters.assigneeId === null) {
      where.push('t.assignee_id IS NULL');
    } else {
      where.push('t.assignee_id = ?');
      values.push(filters.assigneeId);
    }
  }
  if (filters?.siteId !== undefined) {
    where.push('t.site_id = ?');
    values.push(filters.siteId);
  }
  if (filters?.issueType !== undefined) {
    where.push('t.issue_type = ?');
    values.push(filters.issueType);
  }
  const sql =
    'SELECT t.*, u.username as reporter_username, s.name as site_name FROM tickets t' +
    ' JOIN users u ON t.reporter_id = u.id' +
    ' LEFT JOIN sites s ON t.site_id = s.id' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY t.updated_at DESC' +
    (filters?.limit ? ' LIMIT ?' : '') +
    (filters?.offset ? ' OFFSET ?' : '');
  if (filters?.limit) values.push(filters.limit);
  if (filters?.offset) values.push(filters.offset);
  return db.prepare(sql).all(...values) as TicketWithReporter[];
}
