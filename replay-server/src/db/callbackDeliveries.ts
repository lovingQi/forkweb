import { getDb } from './index';

export type CallbackDeliveryStatus = 'pending' | 'succeeded' | 'failed';
export type CallbackEventType = 'analysis.completed' | 'analysis.failed';

export interface DbCallbackDelivery {
  id: number;
  event_id: string;
  ticket_id: number;
  event_type: CallbackEventType;
  payload: string;
  status: CallbackDeliveryStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  last_http_status: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCallbackDeliveryInput {
  eventId: string;
  ticketId: number;
  eventType: CallbackEventType;
  payload: string;
  nextAttemptAt: string;
}

export async function createCallbackDelivery(input: CreateCallbackDeliveryInput): Promise<DbCallbackDelivery> {
  const db = await getDb();
  const result = db.prepare(
    `INSERT INTO callback_deliveries (event_id, ticket_id, event_type, payload, status, attempt_count, next_attempt_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?)`
  ).run(input.eventId, input.ticketId, input.eventType, input.payload, input.nextAttemptAt);
  return getCallbackDeliveryById(Number(result.lastInsertRowid)) as Promise<DbCallbackDelivery>;
}

export async function getCallbackDeliveryById(id: number): Promise<DbCallbackDelivery | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM callback_deliveries WHERE id = ?').get(id) as DbCallbackDelivery | undefined;
}

export async function listCallbackDeliveriesByTicketId(ticketId: number): Promise<DbCallbackDelivery[]> {
  const db = await getDb();
  return db.prepare(
    'SELECT * FROM callback_deliveries WHERE ticket_id = ? ORDER BY created_at ASC, id ASC'
  ).all(ticketId) as DbCallbackDelivery[];
}

export async function listDueCallbackDeliveries(nowIso: string, limit: number): Promise<DbCallbackDelivery[]> {
  const db = await getDb();
  return db.prepare(
    `SELECT * FROM callback_deliveries
     WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC, id ASC
     LIMIT ?`
  ).all(nowIso, limit) as DbCallbackDelivery[];
}

export async function updateCallbackDelivery(
  id: number,
  input: Partial<Pick<
    DbCallbackDelivery,
    'status' | 'attempt_count' | 'next_attempt_at' | 'last_attempt_at' | 'last_http_status' | 'last_error'
  >>
): Promise<DbCallbackDelivery | undefined> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return getCallbackDeliveryById(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE callback_deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getCallbackDeliveryById(id);
}

export async function deleteCallbackDeliveriesByTicketId(ticketId: number): Promise<void> {
  const db = await getDb();
  db.prepare('DELETE FROM callback_deliveries WHERE ticket_id = ?').run(ticketId);
}
