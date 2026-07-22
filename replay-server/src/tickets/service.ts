import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser } from '../auth/middleware';
import { createTicketEvent, listTicketEvents } from '../db/events';
import { createAnalysisVersion } from '../db/analysisVersions';
import { createTicket, getTicketById, listTicketsWithReporter, type DbTicket, type TicketStatus, updateTicket } from '../db/tickets';
import { ensureTicketDirs, getTicketDir, getTicketLogDir, getTicketMapDir, processUploadFiles, type ProcessUploadResult } from '../upload/handler';
import { sendRdNotificationEmail } from '../mail/sender';
import { buildMarkdownReportAsync, buildJsonReport } from '../core/report';
import { exportDiagnosticPackage } from '../core/diagnosticPackage';
import { classifyFromAnalysis } from '../core/issueClassifier';
import { generateTroubleshootingPaths } from '../core/troubleshootingGuide';
import { ReplaySession } from '../core/session';
import { createKnowledgeRule, recordKnowledgeRuleFeedback } from '../core/knowledgeBase';
import { createTroubleshootingPath, getTroubleshootingPathById, listTroubleshootingPaths } from '../db/troubleshootingPaths';
import { createTroubleshootingStep, getTroubleshootingStepById } from '../db/troubleshootingSteps';
import { createStepEvent, listStepEvents } from '../db/stepEvents';
import { askReplayAssistant } from '../core/ragAssistant';
import type { KnowledgeRule } from '../types';

function generateTicketNo(): string {
  const now = new Date();
  const prefix = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = uuidv4().slice(0, 6).toUpperCase();
  return `TK${prefix}-${suffix}`;
}

function canAccessTicket(ticket: DbTicket, actor: AuthUser): boolean {
  return actor.role !== 'after_sales' || ticket.reporter_id === actor.id;
}

function assertTicketAccess(ticket: DbTicket, actor: AuthUser): void {
  if (!canAccessTicket(ticket, actor)) throw new Error('无权操作该工单');
}

function assertFieldOperator(ticket: DbTicket, actor: AuthUser): void {
  if (actor.role !== 'after_sales' && actor.role !== 'admin') throw new Error('仅现场人员或管理员可执行此操作');
  assertTicketAccess(ticket, actor);
}

function assertRdOperator(ticket: DbTicket, actor: AuthUser): void {
  if (actor.role !== 'rd' && actor.role !== 'admin') throw new Error('仅研发或管理员可执行此操作');
  if (actor.role === 'rd' && ticket.assignee_id !== actor.id) throw new Error('仅工单认领人可处理该工单');
}

function assertStatus(ticket: DbTicket, expected: TicketStatus[], action: string): void {
  if (!expected.includes(ticket.status)) throw new Error(`工单当前状态不允许${action}`);
}

export interface CreateTicketServiceInput {
  title: string;
  description: string;
  filePaths: string[];
  originalNames?: string[];
  reporter: AuthUser;
  siteId?: number;
  issueType?: string;
  impactLevel?: string;
  occurredStartAt?: string;
  occurredEndAt?: string;
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
    siteId: input.siteId,
    issueType: input.issueType,
    impactLevel: input.impactLevel,
    occurredStartAt: input.occurredStartAt,
    occurredEndAt: input.occurredEndAt,
    logDir: '', // 稍后更新
    aiEnabled: input.aiEnabled
  });

  await ensureTicketDirs(ticket.id);

  // 处理上传文件：自动解压、识别 .log 和 .json
  const processed = await processUploadFiles(ticket.id, input.filePaths, input.originalNames);
  if (processed.logCount === 0) {
    throw new Error('未找到 .log 日志文件，请至少上传一个日志文件或包含日志的压缩包');
  }

  // 更新 ticket 路径信息
  const updated = await updateTicket(ticket.id, {
    log_dir: processed.logDir,
    map_dir: processed.mapDir || null,
    map_file: processed.mapFile || null
  });
  if (!updated) throw new Error('更新工单路径失败');

  await createTicketEvent({
    ticketId: ticket.id,
    actorId: input.reporter.id,
    action: 'created',
    payload: { title: input.title, logDir: processed.logDir, mapDir: processed.mapDir, mapFile: processed.mapFile, logCount: processed.logCount }
  });

  return updated;
}

export async function startTicketAnalysis(ticketId: number, actor: AuthUser): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertTicketAccess(ticket, actor);
  if (ticket.status === 'analyzing') return ticket;
  assertStatus(ticket, ['pending_analysis', 'pending_field_troubleshooting', 'field_troubleshooting', 'self_solved', 'resolved'], '重新分析');

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
        status: 'pending_field_troubleshooting',
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
  const inferredIssueType = classifyFromAnalysis({
    rootCauses: session.data.overview.rootCauses,
    knowledgeMatches: session.data.knowledgeMatches,
    errorSummaries: session.data.errorSummaries
  });

  const paths = generateTroubleshootingPaths(session.data, ticket);

  const analysisVersion = await createAnalysisVersion({
    ticketId,
    inputLogDir: ticket.log_dir,
    inputMapDir: ticket.map_dir || undefined,
    inputMapFile: ticket.map_file || undefined,
    inputPackageSource: pkgDest,
    occurredStartAt: ticket.occurred_start_at || undefined,
    occurredEndAt: ticket.occurred_end_at || undefined,
    issueType: inferredIssueType,
    topIssues: buildTopIssues(session.data),
    troubleshootingPathsSnapshot: { paths },
    evidenceSummary: buildEvidenceSummary(session.data),
    reportPath: mdPath,
    packagePath: pkgDest
  });

  // 保存排查路径与步骤
  for (const path of paths) {
    const savedPath = await createTroubleshootingPath({
      ticketId,
      analysisVersionId: analysisVersion.id,
      ruleId: path.ruleId,
      title: path.title,
      priority: path.priority,
      confidence: path.confidence,
      severity: path.severity
    });
    for (const step of path.guideSteps) {
      await createTroubleshootingStep({
        pathId: savedPath.id,
        stepNo: step.stepNo,
        title: step.title,
        instruction: step.instruction,
        criteria: step.criteria,
        stepType: step.stepType,
        estimatedTime: step.estimatedTime,
        evidenceConfig: step.evidenceConfig,
        isCritical: step.isCritical,
        failureAction: step.failureAction
      });
    }
  }

  const updatePayload: Parameters<typeof updateTicket>[1] = {
    status: 'pending_field_troubleshooting',
    conclusion,
    report_path: mdPath,
    package_path: pkgDest,
    latest_analysis_version_id: analysisVersion.id,
    issue_type: inferredIssueType
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
    payload: { reportPath: mdPath, packagePath: pkgDest, conclusion, aiEnabled: !!ticket.ai_enabled, analysisVersionId: analysisVersion.id }
  });
}

export async function updateTicketIssueType(
  ticketId: number,
  actor: AuthUser,
  issueType: string
): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertTicketAccess(ticket, actor);

  const updated = await updateTicket(ticketId, { issue_type: issueType });
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'issue_type_updated',
    payload: { issueType, previousIssueType: ticket.issue_type }
  });

  return updated;
}

export async function startFieldTroubleshooting(ticketId: number, actor: AuthUser): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertFieldOperator(ticket, actor);
  assertStatus(ticket, ['pending_field_troubleshooting'], '开始现场排查');
  const updated = await updateTicket(ticketId, { status: 'field_troubleshooting' });
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'field_troubleshooting_started',
    payload: { previousStatus: ticket.status }
  });

  return updated;
}

export async function recordStepStatus(
  ticketId: number,
  pathId: number,
  stepId: number,
  actor: AuthUser,
  input: { status: string; reason?: string; analysisVersionId?: number }
): Promise<void> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertFieldOperator(ticket, actor);
  assertStatus(ticket, ['field_troubleshooting'], '记录排查步骤');
  const validStatuses = ['unchecked', 'passed', 'failed', 'not_applicable'];
  if (!validStatuses.includes(input.status)) {
    throw new Error('无效的步骤状态');
  }
  if (input.status === 'not_applicable' && !input.reason) {
    throw new Error('不适用时必须选择原因');
  }

  const analysisVersionId = input.analysisVersionId ?? ticket.latest_analysis_version_id;
  if (!analysisVersionId) throw new Error('工单尚未生成分析版本');

  const path = await getTroubleshootingPathById(pathId);
  if (!path || path.ticket_id !== ticketId || path.analysis_version_id !== analysisVersionId) {
    throw new Error('排查路径不属于该工单或分析版本');
  }
  const step = await getTroubleshootingStepById(stepId);
  if (!step || step.path_id !== pathId) throw new Error('排查步骤不属于该排查路径');
  const previousEvents = await listStepEvents({ ticketId, analysisVersionId, pathId, stepId });

  await createStepEvent({
    ticketId,
    analysisVersionId,
    pathId,
    stepId,
    actorId: actor.id,
    action: 'step_status_changed',
    fromStatus: previousEvents[0]?.to_status || 'unchecked',
    toStatus: input.status,
    reason: input.reason
  });
}

export async function resolveSelfService(
  ticketId: number,
  actor: AuthUser,
  input: {
    result: string;
    guideFeedback: string;
    note?: string;
  }
): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertFieldOperator(ticket, actor);
  assertStatus(ticket, ['pending_field_troubleshooting', 'field_troubleshooting'], '确认自助解决');
  if (!['useful', 'partial', 'useless'].includes(input.guideFeedback)) throw new Error('无效的向导反馈');

  const updated = await updateTicket(ticketId, {
    status: 'self_solved',
    self_service_result: input.result,
    guide_feedback: input.guideFeedback,
    self_service_note: input.note || null
  });
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'self_solved',
    payload: { previousStatus: ticket.status, result: input.result, guideFeedback: input.guideFeedback }
  });

  const currentPaths = ticket.latest_analysis_version_id
    ? await listTroubleshootingPaths({ ticketId, analysisVersionId: ticket.latest_analysis_version_id })
    : [];
  const updatedRules = await recordKnowledgeRuleFeedback(
    currentPaths.map((path) => path.rule_id),
    input.guideFeedback as 'useful' | 'partial' | 'useless'
  );
  if (updatedRules.length > 0) {
    await createTicketEvent({
      ticketId,
      actorId: actor.id,
      action: 'guide_feedback_recorded',
      payload: {
        guideFeedback: input.guideFeedback,
        ruleIds: updatedRules.map((rule) => rule.id),
        needsReviewRuleIds: updatedRules.filter((rule) => rule.publicationStatus === 'needs_review').map((rule) => rule.id)
      }
    });
  }

  return updated;
}

export async function escalateToRd(
  ticketId: number,
  actor: AuthUser,
  reason: string,
  baseUrl: string
): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertFieldOperator(ticket, actor);
  assertStatus(ticket, ['pending_field_troubleshooting', 'field_troubleshooting'], '升级研发');

  const updated = await updateTicket(ticketId, {
    status: 'pending_rd',
    escalation_reason: reason
  });
  if (!updated) throw new Error('更新工单失败');

  // 收集排查步骤状态和分析版本信息
  const stepEvents = ticket.latest_analysis_version_id
    ? await listStepEvents({ ticketId, analysisVersionId: ticket.latest_analysis_version_id })
    : [];
  const stepStatusSummary = stepEvents.reduce((acc, e) => {
    const key = `${e.path_id}-${e.step_id}`;
    acc[key] = { toStatus: e.to_status, reason: e.reason };
    return acc;
  }, {} as Record<string, { toStatus: string | null; reason: string | null }>);

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'escalated_to_rd',
    payload: {
      previousStatus: ticket.status,
      reason,
      analysisVersionId: ticket.latest_analysis_version_id,
      stepStatusSummary,
      hasLog: !!ticket.log_dir,
      hasReport: !!ticket.report_path
    }
  });

  const ticketUrl = `${baseUrl}/tickets/${ticketId}`;
  try {
    await sendRdNotificationEmail(updated, ticketUrl, {
      analysisVersionId: ticket.latest_analysis_version_id,
      stepStatusSummary,
      reportPath: ticket.report_path,
      packagePath: ticket.package_path
    });
  } catch (e) {
    console.error('[ticket] 邮件通知失败:', e);
    await createTicketEvent({
      ticketId,
      actorId: actor.id,
      action: 'mail_failed',
      payload: { error: e instanceof Error ? e.message : String(e) }
    });
  }

  return updated;
}

/** @deprecated 请使用 resolveSelfService 或 escalateToRd */
export async function verifyTicket(
  ticketId: number,
  result: 'resolved' | 'needs_rd',
  actor: AuthUser,
  baseUrl: string
): Promise<DbTicket> {
  if (result === 'resolved') {
    return resolveSelfService(ticketId, actor, { result: 'other', guideFeedback: 'partial' });
  }
  return escalateToRd(ticketId, actor, 'other', baseUrl);
}

export async function assignTicket(ticketId: number, assignee: AuthUser): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  if (assignee.role !== 'rd' && assignee.role !== 'admin') throw new Error('仅研发或管理员可认领工单');
  assertStatus(ticket, ['pending_rd'], '认领');
  const updated = await updateTicket(ticketId, { assignee_id: assignee.id, status: 'rd_working' });
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
  assertRdOperator(ticket, actor);
  assertStatus(ticket, ['rd_working'], '标记已解决');
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
    publicationStatus: 'draft',
    guideSteps: [],
    feedbackStats: { useful: 0, partial: 0, useless: 0 },
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
  const ticketEvents = await listTicketEvents(ticketId);
  const stepEvents = await listStepEvents({ ticketId });
  const mergedEvents = [
    ...ticketEvents,
    ...stepEvents.map((e) => ({
      id: e.id,
      ticket_id: e.ticket_id,
      actor_id: e.actor_id,
      action: e.action,
      payload: JSON.stringify({
        analysisVersionId: e.analysis_version_id,
        pathId: e.path_id,
        stepId: e.step_id,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        reason: e.reason,
      }),
      created_at: e.created_at,
    })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return { ticket, events: mergedEvents };
}

export async function listUserTickets(
  user: AuthUser,
  filters?: { reporterId?: number; status?: TicketStatus | TicketStatus[]; siteId?: number; issueType?: string }
): Promise<Array<DbTicket & { reporter_username: string; site_name?: string }>> {
  const baseFilters: Parameters<typeof listTicketsWithReporter>[0] = { limit: 200 };
  if (filters?.status !== undefined) baseFilters.status = filters.status;
  if (filters?.siteId !== undefined) baseFilters.siteId = filters.siteId;
  if (filters?.issueType !== undefined) baseFilters.issueType = filters.issueType;

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

function buildTopIssues(data: any): any[] {
  const rootCauses = data.overview?.rootCauses || [];
  if (rootCauses.length > 0) {
    return rootCauses.slice(0, 3).map((c: any) => ({
      title: c.title,
      severity: c.severity,
      confidence: c.confidence,
      suggestion: c.suggestion
    }));
  }
  const topIssues = data.overview?.topIssues || [];
  return topIssues.slice(0, 3).map((e: any) => ({
    title: e.title,
    severity: e.level,
    timestamp: e.timestamp,
    detail: e.detail
  }));
}

function buildEvidenceSummary(data: any): any {
  return {
    errorCount: data.overview?.errorCount ?? 0,
    warningCount: data.overview?.warningCount ?? 0,
    errorCodeCount: data.overview?.errorCodeCount ?? 0,
    taskCount: data.overview?.taskCount ?? 0,
    frameCount: data.overview?.frameCount ?? 0,
    durationMs: data.overview?.durationMs ?? 0,
    hasMap: data.overview?.hasMap ?? false,
    mapMatch: data.overview?.mapMatch,
    robotName: data.overview?.robotName,
    version: data.overview?.version,
    branch: data.overview?.branch
  };
}

function buildTroubleshootingPathsSnapshot(data: any): any {
  // 阶段 6 之前，先用根因候选和知识匹配作为排查路径快照占位
  const rootCausePaths = (data.overview?.rootCauses || []).slice(0, 3).map((c: any, idx: number) => ({
    priority: idx,
    title: c.title,
    severity: c.severity,
    confidence: c.confidence,
    suggestion: c.suggestion,
    source: c.source || 'built_in',
    ruleId: c.knowledgeRuleId
  }));
  if (rootCausePaths.length > 0) return { paths: rootCausePaths };
  const knowledgePaths = (data.knowledgeMatches || []).slice(0, 3).map((m: any, idx: number) => ({
    priority: idx,
    title: m.title,
    severity: m.severity,
    confidence: m.confidence,
    suggestion: m.suggestion,
    source: 'knowledge_base',
    ruleId: m.ruleId
  }));
  return { paths: knowledgePaths };
}
