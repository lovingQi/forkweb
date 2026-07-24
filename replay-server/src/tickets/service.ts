import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser } from '../auth/middleware';
import { getDb } from '../db/index';
import { createTicketEvent, deleteEventsByTicketId, listTicketEvents } from '../db/events';
import { createAnalysisVersion, deleteAnalysisVersionsByTicketId, getLatestAnalysisVersion, listAnalysisVersions } from '../db/analysisVersions';
import { countTicketsWithReporter, createTicket, getTicketById, listTicketsWithReporter, type DbTicket, type TicketStatus, updateTicket } from '../db/tickets';
import { ensureTicketDirs, getTicketDir, getTicketLogDir, getTicketMapDir, processUploadFiles, type ProcessUploadResult } from '../upload/handler';
import { deleteTempFile, getTempFiles, type PendingTempFile } from '../upload/tempFiles';
import { sendRdNotificationEmail } from '../mail/sender';
import { sendWechatWorkNotification } from '../notify/wechatWork';
import { buildMarkdownReportAsync, buildJsonReport } from '../core/report';
import { exportDiagnosticPackage } from '../core/diagnosticPackage';
import { classifyFromAnalysis } from '../core/issueClassifier';
import { generateTroubleshootingPaths } from '../core/troubleshootingGuide';
import { ReplaySession } from '../core/session';
import { createKnowledgeRule, recordKnowledgeRuleFeedback } from '../core/knowledgeBase';
import { createTroubleshootingPath, deletePathsByTicketId, getTroubleshootingPathById, listTroubleshootingPaths } from '../db/troubleshootingPaths';
import { createTroubleshootingStep, deleteStepsByTicketId, getTroubleshootingStepById } from '../db/troubleshootingSteps';
import { createStepEvent, deleteStepEventsByTicketId, listStepEvents } from '../db/stepEvents';
import { getSiteById } from '../db/sites';
import { getUserById } from '../db/users';
import { getModelById } from '../db/vehicleModels';
import { askReplayAssistant } from '../core/ragAssistant';
import { readLlmConfig } from '../core/llmConfig';
import { OpenAiCompatibleClient } from '../core/openAiCompatibleClient';
import { LlmProviderError } from '../core/llmProvider';
import type { KnowledgeRule } from '../types';
import { ZipArchive, type Archiver } from 'archiver';

const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

interface AnalysisRun {
  id: symbol;
  timeout: NodeJS.Timeout;
}

const activeAnalysisRuns = new Map<number, AnalysisRun>();

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

const TERMINAL_STATUSES: TicketStatus[] = ['resolved', 'self_solved', 'cancelled'];

function isTerminalStatus(status: TicketStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface CreateTicketServiceInput {
  title: string;
  description: string;
  filePaths: string[];
  originalNames?: string[];
  reporter: AuthUser;
  siteId?: number;
  vehicleModelId?: number;
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
    vehicleModelId: input.vehicleModelId,
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

export interface CreateTicketWithTempFilesInput extends Omit<CreateTicketServiceInput, 'filePaths' | 'originalNames'> {
  tempFileIds: string[];
}

export async function createTicketWithTempFiles(input: CreateTicketWithTempFilesInput): Promise<DbTicket> {
  const tempFiles = await getTempFiles(input.tempFileIds);
  if (tempFiles.length === 0) {
    throw new Error('请至少上传一个文件');
  }
  if (tempFiles.length !== input.tempFileIds.length) {
    throw new Error('部分临时文件已过期或不存在，请重新上传');
  }

  const totalSize = tempFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_UPLOAD_BYTES) {
    throw new Error('所有上传文件总大小不能超过 200MB');
  }

  const ticket = await createTicketWithUploads({
    ...input,
    filePaths: tempFiles.map((f) => f.path),
    originalNames: tempFiles.map((f) => f.originalName)
  });

  // 创建成功后删除临时文件记录
  await Promise.all(input.tempFileIds.map((id) => deleteTempFile(id).catch(() => undefined)));

  return ticket;
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
  const runId = Symbol(`ticket-analysis-${ticketId}`);
  const timeout = setTimeout(() => {
    const activeRun = activeAnalysisRuns.get(ticketId);
    if (!activeRun || activeRun.id !== runId) return;
    activeAnalysisRuns.delete(ticketId);
    void revertFailedAnalysis(ticketId, actor, 'analysis_timeout', '自动分析超时（超过 10 分钟）');
  }, ANALYSIS_TIMEOUT_MS);
  activeAnalysisRuns.set(ticketId, { id: runId, timeout });
  runTicketAnalysisInBackground(ticketId, actor, runId);

  return (await getTicketById(ticketId))!;
}

function isActiveAnalysisRun(ticketId: number, runId: symbol): boolean {
  return activeAnalysisRuns.get(ticketId)?.id === runId;
}

function finishAnalysisRun(ticketId: number, runId: symbol): boolean {
  const activeRun = activeAnalysisRuns.get(ticketId);
  if (!activeRun || activeRun.id !== runId) return false;
  clearTimeout(activeRun.timeout);
  activeAnalysisRuns.delete(ticketId);
  return true;
}

async function revertFailedAnalysis(
  ticketId: number,
  actor: AuthUser,
  action: 'analysis_failed' | 'analysis_timeout',
  reason: string
): Promise<void> {
  const ticket = await getTicketById(ticketId);
  if (!ticket || ticket.status !== 'analyzing') return;

  await updateTicket(ticketId, {
    status: 'pending_analysis',
    conclusion: action === 'analysis_timeout' ? reason : `自动分析失败: ${reason}`
  });
  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action,
    payload: action === 'analysis_timeout' ? { timeoutMs: ANALYSIS_TIMEOUT_MS, error: reason } : { error: reason }
  });
}

function runTicketAnalysisInBackground(ticketId: number, actor: AuthUser, runId: symbol): void {
  setImmediate(async () => {
    const ticket = await getTicketById(ticketId);
    if (!ticket || !isActiveAnalysisRun(ticketId, runId)) return;

    const session = new ReplaySession();
    try {
      await session.load({
        logDir: ticket.log_dir,
        mapDir: ticket.map_dir || undefined,
        mapFile: ticket.map_file || undefined,
        forceReload: true
      });
      if (!isActiveAnalysisRun(ticketId, runId)) return;

      if (ticket.vehicle_model_id) {
        const model = await getModelById(ticket.vehicle_model_id);
        if (model) {
          const catId = model.category_id;
          session.data.knowledgeMatches = (session.data.knowledgeMatches || []).filter((m) => {
            const ids = m.ruleSnapshot?.vehicleCategoryIds || [];
            return ids.length === 0 || ids.includes(catId);
          });
          const keptRuleIds = new Set(session.data.knowledgeMatches.map((m) => m.ruleId));
          session.data.overview.rootCauses = (session.data.overview.rootCauses || []).filter((rc) => {
            if (rc.source !== 'knowledge_base') return true;
            if (!rc.knowledgeRuleId) return false;
            return keptRuleIds.has(rc.knowledgeRuleId);
          });
        }
      }

      await finalizeTicketAnalysis(ticketId, session, actor, () => isActiveAnalysisRun(ticketId, runId));
      finishAnalysisRun(ticketId, runId);
    } catch (e) {
      console.error('[ticket] 自动分析失败:', e);
      if (!finishAnalysisRun(ticketId, runId)) return;
      await revertFailedAnalysis(ticketId, actor, 'analysis_failed', e instanceof Error ? e.message : String(e));
    }
  });
}

async function finalizeTicketAnalysis(
  ticketId: number,
  session: ReplaySession,
  actor: AuthUser,
  isRunActive: () => boolean
): Promise<void> {
  if (!isRunActive()) return;
  const ticket = await getTicketById(ticketId);
  if (!ticket || !isRunActive()) return;

  const ticketDir = getTicketDir(ticketId);
  await fs.mkdir(ticketDir, { recursive: true });

  if (!isRunActive()) return;
  const mdReport = await buildMarkdownReportAsync(session.data);
  if (!isRunActive()) return;
  const mdPath = path.join(ticketDir, 'report.md');
  await fs.writeFile(mdPath, mdReport, 'utf8');

  if (!isRunActive()) return;
  const jsonReport = buildJsonReport(session.data);
  const jsonPath = path.join(ticketDir, 'report.json');
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');

  if (!isRunActive()) return;
  const pkg = await exportDiagnosticPackage(session.data, { includeReports: true });
  if (!isRunActive()) return;
  const pkgDest = path.join(ticketDir, 'package.zip');
  await fs.copyFile(pkg.file, pkgDest);

  const conclusion = summarizeRootCauses(session.data.overview.rootCauses);
  const inferredIssueType = classifyFromAnalysis({
    rootCauses: session.data.overview.rootCauses,
    knowledgeMatches: session.data.knowledgeMatches,
    errorSummaries: session.data.errorSummaries
  });

  const paths = generateTroubleshootingPaths(session.data, ticket);

  if (!isRunActive()) return;
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
    if (!isRunActive()) return;
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
      if (!isRunActive()) return;
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

  if (!isRunActive()) return;
  await updateTicket(ticketId, updatePayload);

  if (!isRunActive()) return;
  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'analysis_completed',
    payload: { reportPath: mdPath, packagePath: pkgDest, conclusion, aiEnabled: !!ticket.ai_enabled, analysisVersionId: analysisVersion.id }
  });

  void sendWechatWorkNotification({
    title: '工单分析完成',
    text: `工单 #${ticket.ticket_no} 自动分析已完成，标题：${ticket.title}，问题类型：${updatePayload.issue_type || '未分类'}，可登录系统查看。`
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

export async function cancelTicket(ticketId: number, actor: AuthUser): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  if (ticket.reporter_id !== actor.id) throw new Error('仅提单人可取消该工单');
  if (isTerminalStatus(ticket.status)) throw new Error('工单已终结，不能取消');
  if (ticket.status === 'analyzing') throw new Error('分析中的工单不能取消，请等待分析完成');

  const updated = await updateTicket(ticketId, { status: 'cancelled' });
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'cancelled',
    payload: { previousStatus: ticket.status }
  });

  return updated;
}

export async function deleteTicket(ticketId: number, actor: AuthUser): Promise<void> {
  if (actor.role !== 'admin') {
    throw new Error('仅管理员可删除工单');
  }

  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');

  // 若该工单仍有在内存中的分析任务，先清理超时器，避免删除后回调继续写库
  const activeRun = activeAnalysisRuns.get(ticketId);
  if (activeRun) {
    clearTimeout(activeRun.timeout);
    activeAnalysisRuns.delete(ticketId);
  }

  // 审计留痕：记录删除人和删除前状态
  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'deleted',
    payload: { previousStatus: ticket.status, force: ticket.status === 'analyzing' }
  });

  // 收集需要清理的文件路径
  const filePathsToDelete: string[] = [];
  if (ticket.report_path) filePathsToDelete.push(ticket.report_path);
  if (ticket.package_path) filePathsToDelete.push(ticket.package_path);

  const analysisVersions = await listAnalysisVersions(ticketId);
  for (const version of analysisVersions) {
    if (version.report_path) filePathsToDelete.push(version.report_path);
    if (version.package_path) filePathsToDelete.push(version.package_path);
  }

  // 按依赖顺序删除数据库记录
  await deleteStepEventsByTicketId(ticketId);
  await deleteStepsByTicketId(ticketId);
  await deletePathsByTicketId(ticketId);
  await deleteAnalysisVersionsByTicketId(ticketId);
  await deleteEventsByTicketId(ticketId);
  const db = await getDb();
  db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);

  // 删除磁盘文件和目录
  for (const filePath of filePathsToDelete) {
    await fs.rm(filePath, { recursive: true, force: true }).catch(() => undefined);
  }
  await fs.rm(getTicketDir(ticketId), { recursive: true, force: true }).catch(() => undefined);
}

export interface UpdateTicketBasicInfoInput {
  title?: string;
  description?: string;
  siteId?: number;
  vehicleModelId?: number;
  impactLevel?: string;
  occurredStartAt?: string;
  occurredEndAt?: string;
}

export async function updateTicketBasicInfo(
  ticketId: number,
  actor: AuthUser,
  fields: UpdateTicketBasicInfoInput
): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertTicketAccess(ticket, actor);
  if (isTerminalStatus(ticket.status)) throw new Error('工单已终结，不能编辑基本信息');

  const updates: Parameters<typeof updateTicket>[1] = {};
  if (fields.title !== undefined) {
    const title = fields.title.trim();
    if (!title) throw new Error('标题不能为空');
    updates.title = title;
  }
  if (fields.description !== undefined) {
    const description = fields.description.trim();
    if (!description) throw new Error('描述不能为空');
    updates.description = description;
  }
  if (fields.siteId !== undefined) {
    const site = await getSiteById(fields.siteId);
    if (!site) throw new Error('项目现场不存在');
    updates.site_id = fields.siteId;
  }
  if (fields.vehicleModelId !== undefined) {
    updates.vehicle_model_id = fields.vehicleModelId;
  }
  if (fields.impactLevel !== undefined) {
    if (!['low', 'medium', 'high', 'critical'].includes(fields.impactLevel)) throw new Error('无效的影响程度');
    updates.impact_level = fields.impactLevel;
  }
  if (fields.occurredStartAt !== undefined) updates.occurred_start_at = fields.occurredStartAt || null;
  if (fields.occurredEndAt !== undefined) updates.occurred_end_at = fields.occurredEndAt || null;

  if (Object.keys(updates).length === 0) return ticket;

  const updated = await updateTicket(ticketId, updates);
  if (!updated) throw new Error('更新工单失败');

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'basic_info_updated',
    payload: { ...fields }
  });

  return updated;
}

export async function addTicketComment(
  ticketId: number,
  actor: AuthUser,
  content: string
): Promise<Awaited<ReturnType<typeof createTicketEvent>>> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertTicketAccess(ticket, actor);
  const text = content.trim();
  if (!text) throw new Error('评论内容不能为空');

  return createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'comment',
    payload: { content: text }
  });
}

export interface AppendFilesOptions {
  reanalyze?: boolean;
}

export async function appendFilesToTicket(
  ticketId: number,
  actor: AuthUser,
  filePaths: string[],
  originalNames?: string[],
  options?: AppendFilesOptions
): Promise<DbTicket> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertTicketAccess(ticket, actor);
  if (isTerminalStatus(ticket.status)) throw new Error('工单已终结，不能补充上传');

  const logDir = getTicketLogDir(ticketId);
  await fs.mkdir(logDir, { recursive: true });

  const currentSize = await calculateDirSize(logDir);
  const newSize = filePaths.reduce((total, filePath, idx) => {
    const stat = fsSync.statSync(filePath);
    return total + stat.size;
  }, 0);
  if (currentSize + newSize > MAX_UPLOAD_BYTES) {
    throw new Error('追加后日志总量不能超过 200MB');
  }

  const fileNames: string[] = [];
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const originalName = originalNames?.[i] || path.basename(filePath);
    const dest = path.join(logDir, originalName);
    await fs.copyFile(filePath, dest);
    fileNames.push(originalName);
  }

  await createTicketEvent({
    ticketId,
    actorId: actor.id,
    action: 'files_appended',
    payload: { fileNames, reanalyze: !!options?.reanalyze }
  });

  if (options?.reanalyze) {
    startTicketAnalysis(ticketId, actor);
  }

  return (await getTicketById(ticketId))!;
}

async function calculateDirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await calculateDirSize(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        total += stat.size;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return total;
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function streamTicketFilesZip(
  ticketId: number,
  actor: AuthUser
): Promise<{ archive: Archiver; filename: string }> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  assertTicketAccess(ticket, actor);

  const logDir = getTicketLogDir(ticketId);
  const mapDir = getTicketMapDir(ticketId);

  const hasLogs = await dirExists(logDir);
  const hasMaps = await dirExists(mapDir);
  if (!hasLogs && !hasMaps) {
    throw new Error('工单没有可下载的文件');
  }

  const archive = new ZipArchive({ zlib: { level: 6 } });
  if (hasLogs) {
    archive.directory(logDir, 'logs');
  }
  if (hasMaps) {
    archive.directory(mapDir, 'maps');
  }

  const filename = `ticket-${ticket.ticket_no}-files.zip`;
  return { archive, filename };
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

  void sendWechatWorkNotification({
    title: '工单已升级研发',
    text: `工单 #${updated.ticket_no} 已由售后 ${actor.username} 升级研发，原因：${reason}。[查看详情](${baseUrl}/tickets/${ticketId})`
  });

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

  void sendWechatWorkNotification({
    title: '工单已被认领',
    text: `工单 #${updated.ticket_no} 已被研发 ${assignee.username} 认领。[查看详情](${process.env.REPLAY_SERVER_BASE_URL || 'http://localhost:3001'}/tickets/${ticketId})`
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

export interface KnowledgeSuggestion {
  title?: string;
  description?: string;
  rootCause?: string;
  solution?: string;
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

  void sendWechatWorkNotification({
    title: '工单已解决',
    text: `工单 #${updated.ticket_no} 已由研发 ${actor.username} 解决。[查看详情](${process.env.REPLAY_SERVER_BASE_URL || 'http://localhost:3001'}/tickets/${ticketId})`
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
  if (actor.role !== 'admin' && actor.role !== 'rd') {
    throw new Error('仅管理员或研发可沉淀知识规则');
  }
  const allowedStatuses: TicketStatus[] = ['pending_field_troubleshooting', 'rd_working', 'resolved', 'self_solved'];
  if (!allowedStatuses.includes(ticket.status)) {
    throw new Error('当前工单状态不允许沉淀知识规则');
  }

  let vehicleCategoryIds: number[] = [];
  if (ticket.vehicle_model_id) {
    const model = await getModelById(ticket.vehicle_model_id);
    if (model) vehicleCategoryIds = [model.category_id];
  }

  const rule = await createKnowledgeRule({
    title: input.title,
    description: input.description,
    rootCause: input.rootCause,
    solution: input.solution,
    severity: 'error',
    tags: ['工单沉淀'],
    enabled: true,
    publicationStatus: 'draft',
    vehicleCategoryIds,
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

const KNOWLEDGE_SUGGESTION_STATUSES: TicketStatus[] = ['pending_field_troubleshooting', 'rd_working', 'resolved', 'self_solved'];

export async function suggestKnowledgeFromTicket(ticketId: number, actor: AuthUser): Promise<KnowledgeSuggestion> {
  if (actor.role !== 'admin' && actor.role !== 'rd') {
    throw new Error('仅管理员或研发可生成知识建议');
  }

  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error('工单不存在');
  if (!KNOWLEDGE_SUGGESTION_STATUSES.includes(ticket.status)) {
    throw new Error('当前工单状态不允许生成知识建议');
  }

  const config = await readLlmConfig();
  if (!config.apiKey) {
    throw new LlmProviderError('未配置 LLM API Key', 'missing_api_key');
  }

  const analysisVersion = await getLatestAnalysisVersion(ticketId);

  const topIssues = analysisVersion
    ? (JSON.parse(analysisVersion.top_issues || '[]') as unknown[])
    : [];
  const evidenceSummary = analysisVersion?.evidence_summary
    ? (JSON.parse(analysisVersion.evidence_summary) as Record<string, unknown>)
    : undefined;

  const prompt = buildKnowledgeSuggestionPrompt({
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    selfServiceResult: ticket.self_service_result,
    selfServiceNote: ticket.self_service_note,
    guideFeedback: ticket.guide_feedback,
    conclusion: ticket.conclusion,
    issueType: ticket.issue_type,
    topIssues,
    evidenceSummary
  });

  const client = new OpenAiCompatibleClient(config);
  const response = await client.chatJson(
    [
      {
        role: 'system',
        content:
          '你是一位叉车售后技术支持专家，擅长从工单和分析报告中提取关键信息并沉淀为知识规则。' +
          '请根据用户提供的工单信息，生成一条知识规则草稿的字段建议。' +
          '只返回合法的 JSON 对象，不要包含任何解释文本。JSON 字段如下：' +
          'title（知识标题，简短概括问题）、description（现象描述）、rootCause（根因分析）、solution（解决方案）、' +
          'keywords（关键词数组）、modules（涉及模块数组）、errorCodes（错误码数组）。' +
          '如果某些字段无法从输入中推断，可以留空字符串或空数组。'
      },
      { role: 'user', content: prompt }
    ],
    { maxTokens: 1200, temperature: 0.3 }
  );

  return normalizeKnowledgeSuggestion(response);
}

function buildKnowledgeSuggestionPrompt(input: {
  title: string;
  description: string;
  status: string;
  selfServiceResult: string | null;
  selfServiceNote: string | null;
  guideFeedback: string | null;
  conclusion: string | null;
  issueType: string | null;
  topIssues: unknown[];
  evidenceSummary?: Record<string, unknown>;
}): string {
  const parts = [
    `工单标题：${input.title}`,
    `工单描述：${input.description}`,
    `工单状态：${input.status}`,
    input.issueType ? `问题类型：${input.issueType}` : '',
    input.conclusion ? `自动分析结论：${input.conclusion}` : ''
  ];
  if (input.status === 'self_solved') {
    parts.push(input.selfServiceResult ? `自助解决方式：${input.selfServiceResult}` : '');
    parts.push(input.guideFeedback ? `向导反馈：${input.guideFeedback}` : '');
    parts.push(input.selfServiceNote ? `补充说明：${input.selfServiceNote}` : '');
  }
  if (input.topIssues.length > 0) {
    parts.push(`Top 疑似问题：\n${input.topIssues.map((issue, idx) => `${idx + 1}. ${(issue as { title?: string }).title || JSON.stringify(issue)}`).join('\n')}`);
  }
  if (input.evidenceSummary) {
    parts.push(`证据摘要：${JSON.stringify(input.evidenceSummary, null, 2)}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

function normalizeKnowledgeSuggestion(response: unknown): KnowledgeSuggestion {
  if (!response || typeof response !== 'object') {
    return {};
  }
  const data = response as Record<string, unknown>;
  const pickString = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value.trim() || undefined;
    return undefined;
  };
  const pickArray = (value: unknown): string[] | undefined => {
    if (Array.isArray(value)) {
      const arr = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
      return arr.length ? arr : undefined;
    }
    return undefined;
  };
  const suggestion: KnowledgeSuggestion = {};
  const title = pickString(data.title);
  if (title) suggestion.title = title;
  const description = pickString(data.description);
  if (description) suggestion.description = description;
  const rootCause = pickString(data.rootCause);
  if (rootCause) suggestion.rootCause = rootCause;
  const solution = pickString(data.solution);
  if (solution) suggestion.solution = solution;
  const keywords = pickArray(data.keywords);
  if (keywords) suggestion.keywords = keywords;
  const modules = pickArray(data.modules);
  if (modules) suggestion.modules = modules;
  const errorCodes = pickArray(data.errorCodes);
  if (errorCodes) suggestion.errorCodes = errorCodes;
  return suggestion;
}

export interface TicketEventWithActor {
  id: number;
  ticket_id: number;
  actor_id: number | null;
  action: string;
  payload: string | null;
  created_at: string;
  actorName: string;
}

export async function getTicketDetail(ticketId: number): Promise<{
  ticket: DbTicket;
  events: TicketEventWithActor[];
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

  const actorIds = Array.from(
    new Set(mergedEvents.map((e) => e.actor_id).filter((id): id is number => id !== null))
  );
  const users = await Promise.all(actorIds.map((id) => getUserById(id)));
  const userMap = new Map(
    users.filter((u): u is NonNullable<typeof u> => !!u).map((u) => [u.id, u.display_name || u.username])
  );

  const events: TicketEventWithActor[] = mergedEvents.map((e) => ({
    ...e,
    actorName: e.actor_id ? userMap.get(e.actor_id) || '未知用户' : '系统'
  }));

  return { ticket, events };
}

export interface ListUserTicketsInput {
  page?: number;
  pageSize?: number;
  reporterId?: number;
  status?: TicketStatus | TicketStatus[];
  siteId?: number;
  issueType?: string;
  vehicleModelId?: number;
}

export interface ListUserTicketsOutput {
  tickets: Array<DbTicket & { reporter_username: string; site_name?: string; vehicle_model_name?: string; vehicle_category_name?: string }>;
  total: number;
}

export async function listUserTickets(
  user: AuthUser,
  filters?: ListUserTicketsInput
): Promise<ListUserTicketsOutput> {
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters?.pageSize ?? 20));

  const baseFilters: Parameters<typeof listTicketsWithReporter>[0] = {
    limit: pageSize,
    offset: (page - 1) * pageSize
  };
  const countFilters: Parameters<typeof countTicketsWithReporter>[0] = {};

  const applyFilters = (target: typeof baseFilters) => {
    if (filters?.status !== undefined) target.status = filters.status;
    if (filters?.siteId !== undefined) target.siteId = filters.siteId;
    if (filters?.issueType !== undefined) target.issueType = filters.issueType;
    if (filters?.vehicleModelId !== undefined) target.vehicleModelId = filters.vehicleModelId;
  };
  applyFilters(baseFilters);
  applyFilters(countFilters);

  if (user.role === 'rd' || user.role === 'admin') {
    if (filters?.reporterId !== undefined) {
      baseFilters.reporterId = filters.reporterId;
      countFilters.reporterId = filters.reporterId;
    }
  } else {
    baseFilters.reporterId = user.id;
    countFilters.reporterId = user.id;
  }

  const [tickets, total] = await Promise.all([
    listTicketsWithReporter(baseFilters),
    countTicketsWithReporter(countFilters)
  ]);
  return { tickets, total };
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
