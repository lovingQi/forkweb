import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser } from '../auth/middleware';
import { createTicketEvent, listTicketEvents } from '../db/events';
import { createTicket, getTicketById, listTicketsWithReporter, type DbTicket, type TicketStatus, updateTicket } from '../db/tickets';
import { ensureTicketDirs, extractLogArchive, getTicketDir, getTicketLogDir, getTicketMapDir, saveMapFile } from '../upload/handler';
import { sendRdNotificationEmail } from '../mail/sender';
import { buildMarkdownReportAsync, buildJsonReport } from '../core/report';
import { exportDiagnosticPackage } from '../core/diagnosticPackage';
import { ReplaySession } from '../core/session';
import { createKnowledgeRule } from '../core/knowledgeBase';
import { askReplayAssistant } from '../core/ragAssistant';
import type { KnowledgeRule } from '../types';

function generateTicketNo(): string {
  const now = new Date();
  const prefix = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = uuidv4().slice(0, 6).toUpperCase();
  return `TK${prefix}-${suffix}`;
}

export interface CreateTicketServiceInput {
  title: string;
  description: string;
  logArchivePath: string;
  logOriginalName?: string;
  mapFilePath?: string;
  reporter: AuthUser;
  aiEnabled?: boolean;
}

export async function createTicketWithUploads(input: CreateTicketServiceInput): Promise<DbTicket> {
  const ticketNo = generateTicketNo();

  // 先创建 ticket 记录占位，拿到 ticketId
  const ticket = await createTicket({
    ticketNo,
    title: input.title,
    description: input.description,
    reporterId: input.reporter.id,
    logDir: '', // 稍后更新
    aiEnabled: input.aiEnabled
  });

  await ensureTicketDirs(ticket.id);

  // 解压日志
  const logDir = await extractLogArchive(ticket.id, input.logArchivePath, input.logOriginalName);

  // 保存地图
  let mapDir: string | undefined;
  let mapFile: string | undefined;
  if (input.mapFilePath) {
    const savedMap = await saveMapFile(ticket.id, input.mapFilePath);
    mapDir = getTicketMapDir(ticket.id);
    mapFile = savedMap;
  }

  // 更新 ticket 路径信息
  const updated = await updateTicket(ticket.id, {
    log_dir: logDir,
    map_dir: mapDir || null,
    map_file: mapFile || null
  });
  if (!updated) throw new Error('更新工单路径失败');

  await createTicketEvent({
    ticketId: ticket.id,
    actorId: input.reporter.id,
    action: 'created',
    payload: { title: input.title, logDir, mapDir, mapFile }
  });

  return updated;
}

export async function startTicketAnalysis(ticketId: number, actor: AuthUser): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  if (ticket.status === 'analyzing') return ticket;

  await updateTicket(ticketId, { status: 'analyzing' });

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'analysis_started',
    payload: { logDir: ticket.log_dir, mapDir: ticket.map_dir, mapFile: ticket.map_file }
  });

  // 每个工单独立 session，后台运行，互不干扰
  runTicketAnalysisInBackground(ticketId, actor);

  return (await getTicketById(ticketId))!;
}

function runTicketAnalysisInBackground(ticketId: number, actor: AuthUser): void {
  setImmediate(async () => {
    const ticket = await getTicketById(ticketId);
    if (!ticket) return;

    const session = new ReplaySession();
    try {
      await session.load({
        logDir: ticket.log_dir,
        mapDir: ticket.map_dir || undefined,
        mapFile: ticket.map_file || undefined,
        forceReload: true
      });
      await finalizeTicketAnalysis(ticketId, session, actor);
    } catch (e) {
      console.error('[ticket] 自动分析失败:', e);
      await updateTicket(ticketId, {
        status: 'analyzed',
        conclusion: `自动分析失败: ${e instanceof Error ? e.message : String(e)}`
      });
      await createTicketEvent({
        ticketId,
        actorId: actor.id,
        action: 'analysis_failed',
        payload: { error: e instanceof Error ? e.message : String(e) }
      });
    }
  });
}

async function finalizeTicketAnalysis(ticketId: number, session: ReplaySession, actor: AuthUser): Promise<void> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return;

  const ticketDir = getTicketDir(ticketId);
  await fs.mkdir(ticketDir, { recursive: true });

  const mdReport = await buildMarkdownReportAsync(session.data);
  const mdPath = path.join(ticketDir, 'report.md');
  await fs.writeFile(mdPath, mdReport, 'utf8');

  const jsonReport = buildJsonReport(session.data);
  const jsonPath = path.join(ticketDir, 'report.json');
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');

  const pkg = await exportDiagnosticPackage(session.data, { includeReports: true });
  const pkgDest = path.join(ticketDir, 'package.zip');
  await fs.copyFile(pkg.file, pkgDest);

  const conclusion = summarizeRootCauses(session.data.overview.rootCauses);

  const updatePayload: Parameters<typeof updateTicket>[1] = {
    status: 'analyzed',
    conclusion,
    report_path: mdPath,
    package_path: pkgDest
  };

  if (ticket.ai_enabled) {
    try {
      const aiAnswer = await askReplayAssistant(session.data, {
        question: `${ticket.title}：${ticket.description}`,
        includeLogs: true,
        maxLogLines: 120,
        maxKnowledge: 8
      });
      updatePayload.ai_conclusion = JSON.stringify(aiAnswer);
      updatePayload.ai_offline = aiAnswer.offline ? 1 : 0;
    } catch (e) {
      console.error('[ticket] AI 分析失败:', e);
      updatePayload.ai_conclusion = JSON.stringify({
        answer: `AI 分析调用失败：${e instanceof Error ? e.message : String(e)}`,
        provider: 'offline',
        offline: true
      });
      updatePayload.ai_offline = 1;
    }
  }

  await updateTicket(ticketId, updatePayload);

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'analysis_completed',
    payload: { reportPath: mdPath, packagePath: pkgDest, conclusion, aiEnabled: !!ticket.ai_enabled }
  });
}

export async function verifyTicket(
  ticketId: number,
  result: 'resolved' | 'needs_rd',
  actor: AuthUser,
  baseUrl: string
): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  if (ticket.reporter_id !== actor.id && actor.role !== 'rd' && actor.role !== 'admin') {
    throw new Error('无权操作该工单');
  }

  const status: TicketStatus = result === 'resolved' ? 'resolved' : 'needs_rd';
  const updated = await updateTicket(ticketId, { status });
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: result === 'resolved' ? 'marked_resolved' : 'needs_rd',
    payload: { previousStatus: ticket.status }
  });

  if (result === 'needs_rd') {
    const ticketUrl = `${baseUrl}/tickets/${ticketId}`;
    try {
      await sendRdNotificationEmail(updated, ticketUrl);
    } catch (e) {
      console.error('[ticket] 邮件通知失败:', e);
      await createTicketEvent({
        ticketId,
        actorId: actor.id,
        action: 'mail_failed',
        payload: { error: e instanceof Error ? e.message : String(e) }
      });
    }
  }

  return updated;
}

export async function assignTicket(ticketId: number, assignee: AuthUser): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  const updated = await updateTicket(ticketId, { assignee_id: assignee.id, status: 'verifying' });
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: assignee.id,
    action: 'assigned',
    payload: { assigneeId: assignee.id }
  });

  return updated;
}

export interface KnowledgeFromTicketInput {
  title: string;
  description: string;
  rootCause: string;
  solution: string;
  keywords?: string[];
  modules?: string[];
  errorCodes?: string[];
}

export interface KnowledgeFromTicketInput {
  title: string;
  description: string;
  rootCause: string;
  solution: string;
  keywords?: string[];
  modules?: string[];
  errorCodes?: string[];
}

export async function resolveTicket(
  ticketId: number,
  solution: string,
  actor: AuthUser
): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  const updated = await updateTicket(ticketId, {
    status: 'resolved',
    conclusion: solution
  });
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'resolved_by_rd',
    payload: { solution }
  });

  return updated;
}

export async function createKnowledgeFromTicket(
  ticketId: number,
  input: KnowledgeFromTicketInput,
  actor: AuthUser
): Promise<KnowledgeRule> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');

  const rule = await createKnowledgeRule({
    title: input.title,
    description: input.description,
    rootCause: input.rootCause,
    solution: input.solution,
    severity: 'error',
    tags: ['工单沉淀'],
    enabled: true,
    pattern: {
      requiredLineRegexes: [],
      requiredVehicleStates: [],
      requiredKeywords: input.keywords || [],
      anyKeywords: input.keywords || [],
      excludedKeywords: [],
      modules: input.modules || [],
      levels: [],
      errorCodes: input.errorCodes || [],
      windowSeconds: 10,
      minOccurrences: 1,
      confidenceBase: 0.7,
      confidenceWeights: [
        ...(input.modules || []).map((m) => ({ type: 'module' as const, value: m, weight: 0.08 })),
        ...(input.errorCodes || []).map((c) => ({ type: 'errorCode' as const, value: c, weight: 0.16 })),
        ...(input.keywords || []).map((k) => ({ type: 'keyword' as const, value: k, weight: 0.06 }))
      ]
    },
    examples: [],
    createdBy: actor.username
  });

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'knowledge_created',
    payload: { ruleId: rule.id, title: rule.title }
  });

  return rule;
}

export async function getTicketDetail(ticketId: number): Promise<{
  ticket: DbTicket;
  events: Awaited<ReturnType<typeof listTicketEvents>>;
}> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  const events = await listTicketEvents(ticketId);
  return { ticket, events };
}

export async function listUserTickets(
  user: AuthUser,
  filters?: { reporterId?: number; status?: TicketStatus | TicketStatus[] }
): Promise<Array<DbTicket & { reporter_username: string }>> {
  const baseFilters: Parameters<typeof listTicketsWithReporter>[0] = { limit: 200 };
  if (filters?.status !== undefined) baseFilters.status = filters.status;

  if (user.role === 'rd' || user.role === 'admin') {
    if (filters?.reporterId !== undefined) baseFilters.reporterId = filters.reporterId;
    return listTicketsWithReporter(baseFilters);
  }
  baseFilters.reporterId = user.id;
  return listTicketsWithReporter(baseFilters);
}

function summarizeRootCauses(rootCauses: any[]): string {
  if (!rootCauses || rootCauses.length === 0) return '未识别到明确根因，请人工排查。';
  const top = rootCauses.slice(0, 3);
  return top.map((c) => `[${c.severity}] ${c.title}（置信度 ${Math.round(c.confidence * 100)}%）`).join('；');
}

