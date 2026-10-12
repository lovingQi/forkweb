import type { AuthUser } from '../auth/middleware';
import { getSiteByName } from '../db/sites';
import { getTicketByExternalId, type DbTicket } from '../db/tickets';
import { findModelsByName } from '../db/vehicleModels';
import { createTicketEvent } from '../db/events';
import { createTicketWithUploads, startTicketAnalysis } from '../tickets/service';

const IMPACT_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

export class OpenApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ExternalTicketMatch {
  site: { matched: boolean; name: string | null };
  vehicleModel: { matched: boolean; reason: 'not_provided' | 'not_found' | 'ambiguous' | 'matched' };
}

export interface CreateExternalTicketInput {
  actor: AuthUser;
  externalId: string;
  title: string;
  description: string;
  siteName?: string;
  vehicleModelName?: string;
  vehicleCategoryName?: string;
  impactLevel?: string;
  occurredStartAt?: string;
  occurredEndAt?: string;
  aiEnabled: boolean;
  filePaths: string[];
  originalNames: string[];
}

export interface CreateExternalTicketResult {
  duplicated: boolean;
  ticket: DbTicket;
  matches: ExternalTicketMatch;
  warnings: string[];
}

function emptyMatches(): ExternalTicketMatch {
  return {
    site: { matched: false, name: null },
    vehicleModel: { matched: false, reason: 'not_provided' }
  };
}

function isExternalIdConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code) : '';
  const message = error instanceof Error ? error.message : '';
  return code === 'SQLITE_CONSTRAINT_UNIQUE' && message.includes('external_id');
}

export async function createExternalTicket(input: CreateExternalTicketInput): Promise<CreateExternalTicketResult> {
  const externalId = input.externalId.trim();
  const title = input.title.trim();
  const description = input.description.trim();
  if (!externalId || externalId.length > 128) {
    throw new OpenApiError(400, 'VALIDATION_ERROR', 'externalId 不能为空，且不能超过 128 个字符');
  }
  if (!title || title.length > 200) {
    throw new OpenApiError(400, 'VALIDATION_ERROR', 'title 不能为空，且不能超过 200 个字符');
  }
  if (!description) {
    throw new OpenApiError(400, 'VALIDATION_ERROR', 'description 不能为空');
  }
  const impactLevel = input.impactLevel?.trim();
  if (impactLevel && !IMPACT_LEVELS.has(impactLevel)) {
    throw new OpenApiError(400, 'VALIDATION_ERROR', 'impactLevel 只能是 low、medium、high 或 critical');
  }

  const existing = await getTicketByExternalId(externalId);
  if (existing) {
    return { duplicated: true, ticket: existing, matches: emptyMatches(), warnings: [] };
  }

  const warnings: string[] = [];
  const matches = emptyMatches();
  let siteId: number | undefined;
  const siteName = input.siteName?.trim();
  if (siteName) {
    const site = await getSiteByName(siteName);
    if (site) {
      siteId = site.id;
      matches.site = { matched: true, name: site.name };
    } else {
      matches.site = { matched: false, name: siteName };
      warnings.push(`未匹配到现场：${siteName}`);
    }
  }

  let vehicleModelId: number | undefined;
  const modelName = input.vehicleModelName?.trim();
  const categoryName = input.vehicleCategoryName?.trim();
  if (modelName) {
    const models = await findModelsByName(modelName, categoryName || undefined);
    if (models.length === 1) {
      vehicleModelId = models[0].id;
      matches.vehicleModel = { matched: true, reason: 'matched' };
    } else if (models.length === 0) {
      matches.vehicleModel = { matched: false, reason: 'not_found' };
      warnings.push(`未匹配到车型：${modelName}`);
    } else {
      matches.vehicleModel = { matched: false, reason: 'ambiguous' };
      warnings.push(`车型名称匹配到多个：${modelName}`);
    }
  }

  let ticket: DbTicket;
  try {
    ticket = await createTicketWithUploads({
      title,
      description,
      filePaths: input.filePaths,
      originalNames: input.originalNames,
      reporter: input.actor,
      siteId,
      vehicleModelId,
      impactLevel: impactLevel || undefined,
      occurredStartAt: input.occurredStartAt?.trim() || undefined,
      occurredEndAt: input.occurredEndAt?.trim() || undefined,
      aiEnabled: input.aiEnabled,
      externalId
    });
  } catch (error) {
    if (isExternalIdConflict(error)) {
      const raced = await getTicketByExternalId(externalId);
      if (raced) {
        return { duplicated: true, ticket: raced, matches: emptyMatches(), warnings: [] };
      }
    }
    throw error;
  }

  await createTicketEvent({
    ticketId: ticket.id,
    actorId: input.actor.id,
    action: 'open_api_created',
    payload: {
      externalId,
      siteName: siteName || null,
      vehicleModelName: modelName || null,
      vehicleCategoryName: categoryName || null,
      matches,
      warnings
    }
  });

  await startTicketAnalysis(ticket.id, input.actor);
  const started = await getTicketByExternalId(externalId);
  return {
    duplicated: false,
    ticket: started || ticket,
    matches,
    warnings
  };
}
