import { getDb } from './index';

export type TicketStatus =
  | 'pending_analysis'
  | 'analyzing'
  | 'analyzed'
  | 'verifying'
  | 'resolved'
  | 'needs_rd';

export interface DbTicket {
  id: number;
  ticket_no: string;
  title: string;
  description: string;
  reporter_id: number;
  assignee_id: number | null;
  site_id: number | null;
  status: TicketStatus;
  conclusion: string | null;
  report_path: string | null;
  package_path: string | null;
  log_dir: string;
  map_dir: string | null;
  map_file: string | null;
  ai_enabled: number;
  ai_conclusion: string | null;
  ai_offline: number | null;
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
  logDir: string;
  mapDir?: string;
  mapFile?: string;
  aiEnabled?: boolean;
}

export async function createTicket(input: CreateTicketInput): Promise<DbTicket> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO tickets (ticket_no, title, description, reporter_id, site_id, status, log_dir, map_dir, map_file, ai_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.ticketNo,
    input.title,
    input.description,
    input.reporterId,
    input.siteId ?? null,
    'pending_analysis',
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

export async function listTicketsWithReporter(filters?: {
  reporterId?: number;
  status?: TicketStatus | TicketStatus[];
  assigneeId?: number | null;
  siteId?: number;
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
