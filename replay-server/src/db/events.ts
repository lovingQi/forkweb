import { getDb } from './index';

export interface DbTicketEvent {
  id: number;
  ticket_id: number;
  actor_id: number | null;
  action: string;
  payload: string | null;
  created_at: string;
}

export interface CreateTicketEventInput {
  ticketId: number;
  actorId?: number;
  action: string;
  payload?: Record<string, unknown>;
}

export async function createTicketEvent(input: CreateTicketEventInput): Promise<DbTicketEvent> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO ticket_events (ticket_id, actor_id, action, payload)
     VALUES (?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.ticketId,
    input.actorId || null,
    input.action,
    input.payload ? JSON.stringify(input.payload) : null
  );
  return getTicketEventById(Number(result.lastInsertRowid)) as Promise<DbTicketEvent>;
}

export async function getTicketEventById(id: number): Promise<DbTicketEvent | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_events WHERE id = ?').get(id) as DbTicketEvent | undefined;
}

export async function listTicketEvents(ticketId: number): Promise<DbTicketEvent[]> {
  const db = await getDb();
  return db
    .prepare('SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at ASC')
    .all(ticketId) as DbTicketEvent[];
}

export async function deleteEventsByTicketId(ticketId: number): Promise<void> {
  const db = await getDb();
  db.prepare('DELETE FROM ticket_events WHERE ticket_id = ?').run(ticketId);
}
