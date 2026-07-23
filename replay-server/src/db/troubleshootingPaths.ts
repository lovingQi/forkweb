import { getDb } from './index';

export type TroubleshootingPathStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface DbTroubleshootingPath {
  id: number;
  ticket_id: number;
  analysis_version_id: number;
  rule_id: string;
  title: string;
  priority: number;
  confidence: number;
  severity: string;
  status: TroubleshootingPathStatus;
  created_at: string;
}

export interface CreateTroubleshootingPathInput {
  ticketId: number;
  analysisVersionId: number;
  ruleId: string;
  title: string;
  priority: number;
  confidence: number;
  severity: string;
}

export async function createTroubleshootingPath(input: CreateTroubleshootingPathInput): Promise<DbTroubleshootingPath> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO ticket_troubleshooting_paths (ticket_id, analysis_version_id, rule_id, title, priority, confidence, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.ticketId,
    input.analysisVersionId,
    input.ruleId,
    input.title,
    input.priority,
    input.confidence,
    input.severity
  );
  return getTroubleshootingPathById(Number(result.lastInsertRowid)) as Promise<DbTroubleshootingPath>;
}

export async function getTroubleshootingPathById(id: number): Promise<DbTroubleshootingPath | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_troubleshooting_paths WHERE id = ?').get(id) as DbTroubleshootingPath | undefined;
}

export async function listTroubleshootingPaths(filters?: {
  ticketId?: number;
  analysisVersionId?: number;
}): Promise<DbTroubleshootingPath[]> {
  const db = await getDb();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters?.ticketId !== undefined) {
    where.push('ticket_id = ?');
    values.push(filters.ticketId);
  }
  if (filters?.analysisVersionId !== undefined) {
    where.push('analysis_version_id = ?');
    values.push(filters.analysisVersionId);
  }
  const sql =
    'SELECT * FROM ticket_troubleshooting_paths' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY priority ASC, confidence DESC';
  return db.prepare(sql).all(...values) as DbTroubleshootingPath[];
}

export async function updateTroubleshootingPathStatus(
  id: number,
  status: TroubleshootingPathStatus
): Promise<DbTroubleshootingPath | undefined> {
  const db = await getDb();
  db.prepare('UPDATE ticket_troubleshooting_paths SET status = ? WHERE id = ?').run(status, id);
  return getTroubleshootingPathById(id);
}

export async function deletePathsByTicketId(ticketId: number): Promise<void> {
  const db = await getDb();
  db.prepare('DELETE FROM ticket_troubleshooting_paths WHERE ticket_id = ?').run(ticketId);
}
