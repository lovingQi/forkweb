import type { AuthUser } from '../auth/middleware';
import { getUserById } from '../db/users';
import { listTickets, updateTicket } from '../db/tickets';
import { createTicketEvent } from '../db/events';
import { failInterruptedAnalysis, startTicketAnalysis } from './service';

const MAX_RECOVERIES = 3;

export async function recoverInterruptedAnalyses(): Promise<void> {
  const tickets = await listTickets({ status: 'analyzing' });
  for (const ticket of tickets) {
    const user = await getUserById(ticket.reporter_id);
    if (!user) {
      console.error(`[ticket] 无法恢复工单 ${ticket.ticket_no}：创建人不存在`);
      continue;
    }
    const actor: AuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      email: user.email
    };
    if (ticket.analysis_recover_count >= MAX_RECOVERIES) {
      await failInterruptedAnalysis(ticket.id, actor);
      continue;
    }
    const attempt = ticket.analysis_recover_count + 1;
    await updateTicket(ticket.id, {
      status: 'pending_analysis',
      analysis_recover_count: attempt
    });
    await createTicketEvent({
      ticketId: ticket.id,
      actorId: actor.id,
      action: 'analysis_recovered',
      payload: { attempt }
    });
    await startTicketAnalysis(ticket.id, actor);
  }
}
