import { getDb } from './index';

export interface DbStepEvent {
  id: number;
  ticket_id: number;
  analysis_version_id: number;
  path_id: number;
  step_id: number;
  actor_id: number | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  created_at: string;
}

export interface CreateStepEventInput {
  ticketId: number;
  analysisVersionId: number;
  pathId: number;
  stepId: number;
  actorId?: number;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  reason?: string;
}

export async function createStepEvent(input: CreateStepEventInput): Promise<DbStepEvent> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO ticket_step_events (ticket_id, analysis_version_id, path_id, step_id, actor_id, action, from_status, to_status, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.ticketId,
    input.analysisVersionId,
    input.pathId,
    input.stepId,
    input.actorId ?? null,
    input.action,
    input.fromStatus ?? null,
    input.toStatus ?? null,
    input.reason ?? null
  );
  return getStepEventById(Number(result.lastInsertRowid)) as Promise<DbStepEvent>;
}

export async function getStepEventById(id: number): Promise<DbStepEvent | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_step_events WHERE id = ?').get(id) as DbStepEvent | undefined;
}

export async function listStepEvents(filters?: {
  ticketId?: number;
  stepId?: number;
  pathId?: number;
  analysisVersionId?: number;
}): Promise<DbStepEvent[]> {
  const db = await getDb();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters?.ticketId !== undefined) {
    where.push('ticket_id = ?');
    values.push(filters.ticketId);
  }
  if (filters?.stepId !== undefined) {
    where.push('step_id = ?');
    values.push(filters.stepId);
  }
  if (filters?.pathId !== undefined) {
    where.push('path_id = ?');
    values.push(filters.pathId);
  }
  if (filters?.analysisVersionId !== undefined) {
    where.push('analysis_version_id = ?');
    values.push(filters.analysisVersionId);
  }
  const sql =
    'SELECT * FROM ticket_step_events' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...values) as DbStepEvent[];
}

/**
 * 返回指定分析版本中每个步骤的最后一次状态变更，用于恢复现场排查进度。
 */
export async function listLatestStepEventsByStepIds(
  analysisVersionId: number,
  stepIds: number[]
): Promise<DbStepEvent[]> {
  if (stepIds.length === 0) return [];
  const db = await getDb();
  const placeholders = stepIds.map(() => '?').join(', ');
  const sql = `
    SELECT e.*
    FROM ticket_step_events e
    INNER JOIN (
      SELECT step_id, MAX(id) AS last_id
      FROM ticket_step_events
      WHERE analysis_version_id = ? AND step_id IN (${placeholders})
      GROUP BY step_id
    ) latest ON latest.last_id = e.id
  `;
  return db.prepare(sql).all(analysisVersionId, ...stepIds) as DbStepEvent[];
}
