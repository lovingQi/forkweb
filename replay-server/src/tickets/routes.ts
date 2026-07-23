import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import type { NextFunction, Response } from 'express';
import { CACHE_DIR } from '../paths';
import { authMiddleware, requireRole, type AuthRequest } from '../auth/middleware';
import type { DbTicket, TicketStatus } from '../db/tickets';
import { getTicketById } from '../db/tickets';
import { getSiteById } from '../db/sites';
import { getAnalysisVersionById, listAnalysisVersions, type DbAnalysisVersion } from '../db/analysisVersions';
import { listTroubleshootingPaths } from '../db/troubleshootingPaths';
import { listTroubleshootingStepsByPathIds } from '../db/troubleshootingSteps';
import { listLatestStepEventsByStepIds } from '../db/stepEvents';
import {
  addTicketComment,
  assignTicket,
  cancelTicket,
  createKnowledgeFromTicket,
  createTicketWithUploads,
  escalateToRd,
  getTicketDetail,
  listUserTickets,
  recordStepStatus,
  resolveSelfService,
  resolveTicket,
  startFieldTroubleshooting,
  startTicketAnalysis,
  updateTicketBasicInfo,
  updateTicketIssueType,
  verifyTicket
} from './service';

const router = Router();
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const upload = multer({
  dest: path.join(CACHE_DIR, 'uploads'),
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

async function removeUploadedTempFiles(req: AuthRequest): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  await Promise.all(files.map((file) => fs.rm(file.path, { force: true }).catch(() => undefined)));
}

function uploadTicketFiles(req: AuthRequest, res: Response, next: NextFunction): void {
  upload.array('files', 20)(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    void removeUploadedTempFiles(req).finally(() => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ succeed: false, error: '单个上传文件不能超过 200MB' });
        return;
      }
      res.status(400).json({
        succeed: false,
        error: error instanceof Error ? error.message : '文件上传失败'
      });
    });
  });
}

function getBaseUrl(req: AuthRequest): string {
  const host = req.headers.host || '127.0.0.1:5173';
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const protocol = trustProxy ? (req.headers['x-forwarded-proto'] || 'http') : 'http';
  return `${protocol}://${host}`;
}

// 创建工单（售后）
router.post(
  '/',
  authMiddleware,
  requireRole('after_sales', 'admin'),
  uploadTicketFiles,
  async (req: AuthRequest, res) => {
    try {
      const title = String(req.body.title || '').trim();
      const description = String(req.body.description || '').trim();
      if (!title || !description) {
        res.status(400).json({ succeed: false, error: '标题和描述不能为空' });
        return;
      }

      const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];
      if (uploadedFiles.length === 0) {
        res.status(400).json({ succeed: false, error: '请至少上传一个文件' });
        return;
      }
      const totalUploadBytes = uploadedFiles.reduce((total, file) => total + file.size, 0);
      if (totalUploadBytes > MAX_UPLOAD_BYTES) {
        res.status(413).json({ succeed: false, error: '所有上传文件总大小不能超过 200MB' });
        return;
      }

      const aiEnabled = req.body.aiEnabled === 'true' || req.body.aiEnabled === true;
      const rawSiteId = req.body.siteId ? Number(req.body.siteId) : undefined;
      const siteId = Number.isFinite(rawSiteId) && rawSiteId! > 0 ? rawSiteId : undefined;
      const issueType = req.body.issueType ? String(req.body.issueType).trim() : undefined;
      const impactLevel = req.body.impactLevel ? String(req.body.impactLevel).trim() : undefined;
      const occurredStartAt = req.body.occurredStartAt ? String(req.body.occurredStartAt).trim() : undefined;
      const occurredEndAt = req.body.occurredEndAt ? String(req.body.occurredEndAt).trim() : undefined;
      if (siteId) {
        const site = await getSiteById(siteId);
        if (!site) {
          res.status(400).json({ succeed: false, error: '所选项目现场不存在' });
          return;
        }
      }

      const ticket = await createTicketWithUploads({
        title,
        description,
        filePaths: uploadedFiles.map((f) => f.path),
        originalNames: uploadedFiles.map((f) => f.originalname),
        reporter: req.user!,
        siteId,
        issueType,
        impactLevel,
        occurredStartAt,
        occurredEndAt,
        aiEnabled
      });

      // 自动触发分析
      startTicketAnalysis(ticket.id, req.user!);

      res.json({ succeed: true, ticket: serializeTicket(ticket) });
    } catch (e) {
      res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      await removeUploadedTempFiles(req);
    }
  }
);

// 工单列表
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const status = parseStatusQuery(req.query.status);
    const reporterId = req.query.reporterId ? Number(req.query.reporterId) : undefined;
    const siteId = req.query.siteId ? Number(req.query.siteId) : undefined;
    const issueType = req.query.issueType ? String(req.query.issueType).trim() : undefined;
    const tickets = await listUserTickets(req.user!, {
      status,
      reporterId: Number.isFinite(reporterId) ? reporterId : undefined,
      siteId: Number.isFinite(siteId) && siteId! > 0 ? siteId : undefined,
      issueType
    });
    res.json({ succeed: true, tickets: tickets.map(serializeTicket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

function parseStatusQuery(value: unknown): TicketStatus | TicketStatus[] | undefined {
  if (!value) return undefined;
  const validStatuses: TicketStatus[] = [
    'pending_analysis',
    'analyzing',
    'pending_field_troubleshooting',
    'field_troubleshooting',
    'self_solved',
    'pending_rd',
    'rd_working',
    'resolved',
    'cancelled'
  ];
  const items = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  const statuses = items.filter((s): s is TicketStatus => validStatuses.includes(s as TicketStatus));
  if (statuses.length === 0) return undefined;
  return statuses.length === 1 ? statuses[0] : statuses;
}

// 工单详情
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const { ticket, events } = await getTicketDetail(ticketId);
    if (ticket.site_id) {
      const site = await getSiteById(ticket.site_id);
      if (site) {
        (ticket as DbTicket & { site_name?: string }).site_name = site.name;
      }
    }
    if (req.user!.role === 'after_sales' && ticket.reporter_id !== req.user!.id) {
      res.status(403).json({ succeed: false, error: '无权查看该工单' });
      return;
    }
    res.json({
      succeed: true,
      ticket: serializeTicket(ticket),
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        payload: e.payload ? JSON.parse(e.payload) : null,
        createdAt: e.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 修正问题类型
router.patch('/:id/issue-type', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const issueType = String(req.body.issueType || '').trim();
    const validIssueTypes = [
      'positioning',
      'laser',
      'obstacle_avoidance',
      'map',
      'task_failure',
      'charging',
      'hardware_communication',
      'fork_sensor',
      'unknown'
    ];
    if (!validIssueTypes.includes(issueType)) {
      res.status(400).json({ succeed: false, error: '无效的问题类型' });
      return;
    }
    const ticket = await updateTicketIssueType(ticketId, req.user!, issueType);
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 取消工单
router.post('/:id/cancel', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await cancelTicket(ticketId, req.user!);
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 编辑基本信息
router.patch('/:id/basic-info', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const fields: Parameters<typeof updateTicketBasicInfo>[2] = {};
    if (req.body.title !== undefined) fields.title = String(req.body.title);
    if (req.body.description !== undefined) fields.description = String(req.body.description);
    if (req.body.siteId !== undefined) fields.siteId = Number(req.body.siteId);
    if (req.body.impactLevel !== undefined) fields.impactLevel = String(req.body.impactLevel);
    if (req.body.occurredStartAt !== undefined) fields.occurredStartAt = String(req.body.occurredStartAt || '');
    if (req.body.occurredEndAt !== undefined) fields.occurredEndAt = String(req.body.occurredEndAt || '');
    const ticket = await updateTicketBasicInfo(ticketId, req.user!, fields);
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 发表评论
router.post('/:id/comments', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const content = String(req.body.content || '');
    const event = await addTicketComment(ticketId, req.user!, content);
    res.json({
      succeed: true,
      event: {
        id: event.id,
        action: event.action,
        payload: event.payload ? JSON.parse(event.payload) : null,
        createdAt: event.created_at
      }
    });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 重新分析
router.post('/:id/analyze', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await startTicketAnalysis(ticketId, req.user!);
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 分析版本列表
router.get('/:id/analysis-versions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketDetail(ticketId);
    if (req.user!.role === 'after_sales' && ticket.reporter_id !== req.user!.id) {
      res.status(403).json({ succeed: false, error: '无权查看该工单' });
      return;
    }
    const versions = await listAnalysisVersions(ticketId);
    res.json({ succeed: true, versions: versions.map(serializeAnalysisVersion) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 分析版本详情
router.get('/:id/analysis-versions/:versionId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    const { ticket } = await getTicketDetail(ticketId);
    if (req.user!.role === 'after_sales' && ticket.reporter_id !== req.user!.id) {
      res.status(404).json({ succeed: false, error: '版本不存在' });
      return;
    }
    const version = await getAnalysisVersionById(versionId);
    if (!version || version.ticket_id !== ticketId) {
      res.status(404).json({ succeed: false, error: '版本不存在' });
      return;
    }
    res.json({ succeed: true, version: serializeAnalysisVersion(version) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 切换当前展示的分析版本。版本选择仅影响当前客户端展示，不改写工单最新分析版本。
router.post('/:id/analysis-versions/:versionId/switch', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    const { ticket } = await getTicketDetail(ticketId);
    if (req.user!.role === 'after_sales' && ticket.reporter_id !== req.user!.id) {
      res.status(404).json({ succeed: false, error: '版本不存在' });
      return;
    }
    const version = await getAnalysisVersionById(versionId);
    if (!version || version.ticket_id !== ticketId) {
      res.status(404).json({ succeed: false, error: '版本不存在' });
      return;
    }
    res.json({ succeed: true, ticket: serializeTicket(ticket), version: serializeAnalysisVersion(version) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 排查路径列表
router.get('/:id/troubleshooting-paths', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const analysisVersionId = req.query.analysisVersionId ? Number(req.query.analysisVersionId) : undefined;
    const { ticket } = await getTicketDetail(ticketId);
    if (req.user!.role === 'after_sales' && ticket.reporter_id !== req.user!.id) {
      res.status(403).json({ succeed: false, error: '无权查看该工单' });
      return;
    }
    if (analysisVersionId !== undefined) {
      const version = await getAnalysisVersionById(analysisVersionId);
      if (!version || version.ticket_id !== ticketId) {
        res.status(404).json({ succeed: false, error: '分析版本不存在' });
        return;
      }
    }
    const paths = await listTroubleshootingPaths({
      ticketId,
      analysisVersionId: Number.isFinite(analysisVersionId) ? analysisVersionId : undefined
    });
    const steps = await listTroubleshootingStepsByPathIds(paths.map((p) => p.id));
    const selectedVersionId = analysisVersionId ?? ticket.latest_analysis_version_id;
    const latestEvents = selectedVersionId
      ? await listLatestStepEventsByStepIds(selectedVersionId, steps.map((step) => step.id))
      : [];
    const latestEventByStepId = new Map(latestEvents.map((event) => [event.step_id, event]));
    res.json({
      succeed: true,
      paths: paths.map((p) => ({
        id: p.id,
        analysisVersionId: p.analysis_version_id,
        ruleId: p.rule_id,
        title: p.title,
        priority: p.priority,
        confidence: p.confidence,
        severity: p.severity,
        status: p.status,
        steps: steps.filter((s) => s.path_id === p.id).map((s) => {
          const latestEvent = latestEventByStepId.get(s.id);
          return {
          id: s.id,
          stepNo: s.step_no,
          title: s.title,
          instruction: s.instruction,
          criteria: s.criteria,
          stepType: s.step_type,
          estimatedTime: s.estimated_time,
          evidenceConfig: safeJsonParse(s.evidence_config, null),
          isCritical: s.is_critical === 1,
          failureAction: s.failure_action,
          status: latestEvent?.to_status || 'unchecked',
          statusUpdatedAt: latestEvent?.created_at,
          notApplicableReason: latestEvent?.to_status === 'not_applicable' ? latestEvent.reason : undefined
        };
        })
      }))
    });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 开始现场排查
router.post('/:id/start-troubleshooting', authMiddleware, requireRole('after_sales', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await startFieldTroubleshooting(ticketId, req.user!);
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 记录步骤状态
router.post('/:id/paths/:pathId/steps/:stepId/status', authMiddleware, requireRole('after_sales', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const pathId = Number(req.params.pathId);
    const stepId = Number(req.params.stepId);
    const { status, reason, analysisVersionId } = req.body;
    await recordStepStatus(ticketId, pathId, stepId, req.user!, {
      status: String(status),
      reason: reason ? String(reason) : undefined,
      analysisVersionId: analysisVersionId ? Number(analysisVersionId) : undefined
    });
    res.json({ succeed: true });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 售后验证（兼容旧接口）
router.post('/:id/verify', authMiddleware, requireRole('after_sales', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const result = req.body.result;
    if (result !== 'resolved' && result !== 'needs_rd') {
      res.status(400).json({ succeed: false, error: 'result 必须是 resolved 或 needs_rd' });
      return;
    }
    const ticket = await verifyTicket(ticketId, result, req.user!, getBaseUrl(req));
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 现场确认已解决
router.post('/:id/resolve-self-service', authMiddleware, requireRole('after_sales', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const { result, guideFeedback, note } = req.body;
    if (!result || !guideFeedback) {
      res.status(400).json({ succeed: false, error: 'result 和 guideFeedback 不能为空' });
      return;
    }
    if (!['reboot', 'rewire', 'replace_hardware', 'adjust_config', 'refresh_logs', 'false_positive', 'other'].includes(String(result))
      || !['useful', 'partial', 'useless'].includes(String(guideFeedback))) {
      res.status(400).json({ succeed: false, error: '解决方式或向导反馈无效' });
      return;
    }
    const ticket = await resolveSelfService(ticketId, req.user!, {
      result: String(result),
      guideFeedback: String(guideFeedback),
      note: note ? String(note) : undefined
    });
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 升级研发
router.post('/:id/escalate-to-rd', authMiddleware, requireRole('after_sales', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const { reason } = req.body;
    if (!reason) {
      res.status(400).json({ succeed: false, error: 'reason 不能为空' });
      return;
    }
    if (!['guide_unresolved', 'no_permission_or_tool', 'software_defect', 'untrusted_conclusion', 'need_remote', 'other'].includes(String(reason))) {
      res.status(400).json({ succeed: false, error: '升级原因无效' });
      return;
    }
    const ticket = await escalateToRd(ticketId, req.user!, String(reason), getBaseUrl(req));
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 研发认领
router.post('/:id/assign', authMiddleware, requireRole('rd', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await assignTicket(ticketId, req.user!);
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 研发解决
router.post('/:id/resolve', authMiddleware, requireRole('rd', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const solution = String(req.body.solution || '').trim();
    if (!solution) {
      res.status(400).json({ succeed: false, error: '解决方案不能为空' });
      return;
    }
    const ticket = await resolveTicket(ticketId, solution, req.user!);
    res.json({ succeed: true, ticket: serializeTicket(ticket) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 沉淀到知识库
router.post('/:id/knowledge', authMiddleware, requireRole('rd', 'admin'), async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const { title, description, rootCause, solution, keywords, modules, errorCodes } = req.body;
    if (!title || !description || !rootCause || !solution) {
      res.status(400).json({ succeed: false, error: '标题、描述、根因、解决方案不能为空' });
      return;
    }
    const rule = await createKnowledgeFromTicket(
      ticketId,
      {
        title: String(title),
        description: String(description),
        rootCause: String(rootCause),
        solution: String(solution),
        keywords: Array.isArray(keywords) ? keywords.map(String) : undefined,
        modules: Array.isArray(modules) ? modules.map(String) : undefined,
        errorCodes: Array.isArray(errorCodes) ? errorCodes.map(String) : undefined
      },
      req.user!
    );
    res.json({ succeed: true, rule: { id: rule.id, title: rule.title } });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// 下载报告
router.get('/:id/report', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketDetail(ticketId);
    if (req.user!.role === 'after_sales' && ticket.reporter_id !== req.user!.id) {
      res.status(403).json({ succeed: false, error: '无权查看该工单' });
      return;
    }
    if (!ticket.report_path) {
      res.status(404).json({ succeed: false, error: '报告尚未生成' });
      return;
    }
    const content = await fs.readFile(ticket.report_path, 'utf8');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(content);
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

function serializeTicket(ticket: DbTicket) {
  const withExtra = ticket as DbTicket & { reporter_username?: string; site_name?: string };
  return {
    id: ticket.id,
    ticketNo: ticket.ticket_no,
    title: ticket.title,
    description: ticket.description,
    reporterId: ticket.reporter_id,
    reporterName: withExtra.reporter_username || '',
    siteId: ticket.site_id ?? undefined,
    siteName: withExtra.site_name || undefined,
    assigneeId: ticket.assignee_id,
    status: ticket.status,
    issueType: ticket.issue_type ?? undefined,
    impactLevel: ticket.impact_level ?? undefined,
    occurredStartAt: ticket.occurred_start_at ?? undefined,
    occurredEndAt: ticket.occurred_end_at ?? undefined,
    selfServiceResult: ticket.self_service_result ?? undefined,
    selfServiceNote: ticket.self_service_note ?? undefined,
    guideFeedback: ticket.guide_feedback ?? undefined,
    escalationReason: ticket.escalation_reason ?? undefined,
    conclusion: ticket.conclusion,
    reportPath: ticket.report_path,
    packagePath: ticket.package_path,
    logDir: ticket.log_dir,
    mapDir: ticket.map_dir,
    mapFile: ticket.map_file,
    aiEnabled: ticket.ai_enabled === 1,
    aiConclusion: ticket.ai_conclusion,
    aiOffline: ticket.ai_offline === 1,
    latestAnalysisVersionId: ticket.latest_analysis_version_id ?? undefined,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at
  };
}

function serializeAnalysisVersion(version: DbAnalysisVersion) {
  return {
    id: version.id,
    ticketId: version.ticket_id,
    versionNo: version.version_no,
    inputLogDir: version.input_log_dir,
    inputMapDir: version.input_map_dir,
    inputMapFile: version.input_map_file,
    inputPackageSource: version.input_package_source,
    occurredStartAt: version.occurred_start_at,
    occurredEndAt: version.occurred_end_at,
    issueType: version.issue_type,
    topIssues: safeJsonParse(version.top_issues, []),
    troubleshootingPathsSnapshot: safeJsonParse(version.troubleshooting_paths_snapshot, null),
    evidenceSummary: safeJsonParse(version.evidence_summary, null),
    reportPath: version.report_path,
    packagePath: version.package_path,
    createdAt: version.created_at
  };
}

function safeJsonParse(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export default router;
