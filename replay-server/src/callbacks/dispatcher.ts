import crypto from 'crypto';
import axios from 'axios';
import type { BuiltCallback } from './payload';
import { getCallbackSecret, getCallbackUrl } from '../openapi/config';
import {
  createCallbackDelivery,
  getCallbackDeliveryById,
  listDueCallbackDeliveries,
  updateCallbackDelivery,
  type DbCallbackDelivery
} from '../db/callbackDeliveries';
import { getTicketById } from '../db/tickets';
import { createTicketEvent } from '../db/events';

const MAX_ATTEMPTS = 7;
const RETRY_DELAYS_MS = [
  30 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000
];
const CALLBACK_TIMEOUT_MS = 10000;

const inFlight = new Set<number>();

export function signCallbackBody(secret: string, timestamp: string, body: string): string {
  const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${digest}`;
}

function truncateError(message: string | null): string | null {
  if (!message) return null;
  return message.length > 500 ? message.slice(0, 500) : message;
}

export async function enqueueTicketCallback(ticketId: number, built: BuiltCallback): Promise<void> {
  const delivery = await createCallbackDelivery({
    eventId: built.eventId,
    ticketId,
    eventType: built.eventType,
    payload: JSON.stringify(built.body),
    nextAttemptAt: new Date().toISOString()
  });
  void attemptDelivery(delivery.id);
}

export async function dispatchDueCallbacks(): Promise<void> {
  if (!getCallbackUrl() || !getCallbackSecret()) return;
  const due = await listDueCallbackDeliveries(new Date().toISOString(), 20);
  for (const delivery of due) {
    void attemptDelivery(delivery.id);
  }
}

export function startCallbackDispatcher(): void {
  void dispatchDueCallbacks();
  setInterval(() => {
    void dispatchDueCallbacks();
  }, 15000);
}

export async function retryCallbackDelivery(deliveryId: number): Promise<DbCallbackDelivery> {
  const delivery = await getCallbackDeliveryById(deliveryId);
  if (!delivery) throw new Error('回调记录不存在');
  if (delivery.status === 'succeeded') throw new Error('已送达的回调不能重推');
  const updated = await updateCallbackDelivery(deliveryId, {
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
    last_error: null
  });
  if (!updated) throw new Error('更新回调记录失败');
  void attemptDelivery(deliveryId);
  return updated;
}

async function attemptDelivery(id: number): Promise<void> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const url = getCallbackUrl();
    const secret = getCallbackSecret();
    if (!url || !secret) return;

    const delivery = await getCallbackDeliveryById(id);
    if (!delivery || delivery.status !== 'pending') return;
    if (delivery.next_attempt_at > new Date().toISOString()) return;

    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signCallbackBody(secret, timestamp, delivery.payload);
    let httpStatus: number | null = null;
    let error: string | null = null;
    let ok = false;
    try {
      const response = await axios.post(url, delivery.payload, {
        timeout: CALLBACK_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-Forkweb-Event': delivery.event_type,
          'X-Forkweb-Delivery': delivery.event_id,
          'X-Forkweb-Timestamp': timestamp,
          'X-Forkweb-Signature': signature
        },
        transformRequest: [(data) => data],
        validateStatus: () => true
      });
      httpStatus = response.status;
      ok = response.status >= 200 && response.status < 300;
      if (!ok) error = `HTTP ${response.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const attempt = delivery.attempt_count + 1;
    const now = new Date().toISOString();
    const ticket = await getTicketById(delivery.ticket_id);
    if (ok) {
      await updateCallbackDelivery(id, {
        status: 'succeeded',
        attempt_count: attempt,
        last_attempt_at: now,
        last_http_status: httpStatus,
        last_error: null
      });
      if (ticket) {
        await createTicketEvent({
          ticketId: ticket.id,
          actorId: ticket.reporter_id,
          action: 'callback_delivered',
          payload: { eventId: delivery.event_id, eventType: delivery.event_type, httpStatus }
        });
      }
      return;
    }

    if (attempt >= MAX_ATTEMPTS) {
      await updateCallbackDelivery(id, {
        status: 'failed',
        attempt_count: attempt,
        last_attempt_at: now,
        last_http_status: httpStatus,
        last_error: truncateError(error)
      });
      if (ticket) {
        await createTicketEvent({
          ticketId: ticket.id,
          actorId: ticket.reporter_id,
          action: 'callback_failed',
          payload: { eventId: delivery.event_id, eventType: delivery.event_type, error: truncateError(error) }
        });
      }
      return;
    }

    const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    await updateCallbackDelivery(id, {
      status: 'pending',
      attempt_count: attempt,
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
      last_attempt_at: now,
      last_http_status: httpStatus,
      last_error: truncateError(error)
    });
  } catch (e) {
    console.error('[callback] 发送回调失败:', e instanceof Error ? e.message : String(e));
  } finally {
    inFlight.delete(id);
  }
}
