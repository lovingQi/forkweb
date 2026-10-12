import { v4 as uuidv4 } from 'uuid';
import type { DbTicket } from '../db/tickets';

export interface CallbackAiSummary {
  answer: string;
  rootCauseCandidates: string[];
  suggestions: string[];
  uncertainties: string[];
  offline: boolean;
  provider: string;
  model: string;
}

export interface CallbackTroubleshootingStep {
  stepNo: number;
  title: string;
  instruction: string;
  criteria: string;
}

export interface CallbackTroubleshootingPath {
  title: string;
  severity: string;
  confidence: number;
  steps: CallbackTroubleshootingStep[];
}

export interface BuiltCallback {
  eventId: string;
  eventType: 'analysis.completed' | 'analysis.failed';
  body: Record<string, unknown>;
}

function ticketRef(ticket: DbTicket): { ticketNo: string; externalId: string; title: string } {
  return {
    ticketNo: ticket.ticket_no,
    externalId: ticket.external_id || '',
    title: ticket.title
  };
}

export function buildAnalysisCompletedPayload(input: {
  ticket: DbTicket;
  analysisVersionNo: number;
  conclusion: string | null;
  issueType?: string | null;
  topIssues: unknown[];
  evidenceSummary: unknown;
  troubleshootingPaths: CallbackTroubleshootingPath[];
  ai: CallbackAiSummary | null;
  links: { reportUrl: string | null; packageUrl: string | null };
}): BuiltCallback {
  const eventId = uuidv4();
  return {
    eventId,
    eventType: 'analysis.completed',
    body: {
      eventId,
      eventType: 'analysis.completed',
      status: 'succeeded',
      occurredAt: new Date().toISOString(),
      ticket: ticketRef(input.ticket),
      result: {
        analysisVersionNo: input.analysisVersionNo,
        conclusion: input.conclusion,
        issueType: input.issueType ?? null,
        topIssues: input.topIssues,
        evidenceSummary: input.evidenceSummary,
        troubleshootingPaths: input.troubleshootingPaths,
        ai: input.ai
      },
      links: input.links
    }
  };
}

export function buildAnalysisFailedPayload(input: {
  ticket: DbTicket;
  reason: 'analysis_failed' | 'analysis_timeout';
  message: string;
}): BuiltCallback {
  const eventId = uuidv4();
  return {
    eventId,
    eventType: 'analysis.failed',
    body: {
      eventId,
      eventType: 'analysis.failed',
      status: 'failed',
      occurredAt: new Date().toISOString(),
      ticket: ticketRef(input.ticket),
      error: {
        reason: input.reason,
        message: input.message
      }
    }
  };
}
