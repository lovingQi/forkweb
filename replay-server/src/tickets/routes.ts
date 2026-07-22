import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { CACHE_DIR } from '../paths';
import { authMiddleware, requireRole, type AuthRequest } from '../auth/middleware';
import type { DbTicket, TicketStatus } from '../db/tickets';
import { getTicketById, updateTicket } from '../db/tickets';
import { getSiteById } from '../db/sites';
import { getAnalysisVersionById, listAnalysisVersions, type DbAnalysisVersion } from '../db/analysisVersions';
import { listTroubleshootingPaths } from '../db/troubleshootingPaths';
import { listTroubleshootingSteps, listTroubleshootingStepsByPathIds } from '../db/troubleshootingSteps';
import {
  assignTicket,
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
  updateTicketIssueType,
  verifyTicket
} from './service';

const router = Router();

const upload = multer({
  dest: path.join(CACHE_DIR, 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 }
});

function getBaseUrl(req: AuthRequest): string {
  const host = req.headers.host || '127.0.0.1:5173';
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  return `${protocol}://${host}`;
}

// 创建工单（售后）
router.post(
  '/',
  authMiddleware,
  requireRole('after_sales', 'admin'),
  upload.array('files', 20),
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

      // 清理上传临时文件
      for (const file of uploadedFiles) {
        await fs.rm(file.path, { force: true });
      }

      // 自动触发分析
      startTicketAnalysis(ticket.id, req.user!);

      res.json({ succeed: true, ticket: serializeTicket(ticket) });
    } catch (e) {
      res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
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
    'resolved'
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

// 切换当前展示的分析版本
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
    await updateTicket(ticketId, { latest_analysis_version_id: version.id });
    const updatedTicket = await getTicketById(ticketId);
    res.json({ succeed: true, ticket: serializeTicket(updatedTicket!), version: serializeAnalysisVersion(version) });
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
    const paths = await listTroubleshootingPaths({
      ticketId,
      analysisVersionId: Number.isFinite(analysisVersionId) ? analysisVersionId : undefined
    });
    const steps = await listTroubleshootingStepsByPathIds(paths.map((p) => p.id));
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
        steps: steps.filter((s) => s.path_id === p.id).map((s) => ({
          id: s.id,
          stepNo: s.step_no,
          title: s.title,
          instruction: s.instruction,
          criteria: s.criteria,
          stepType: s.step_type,
          estimatedTime: s.estimated_time,
          evidenceConfig: safeJsonParse(s.evidence_config, null),
          isCritical: s.is_critical === 1,
          failureAction: s.failure_action
        }))
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
    const { status, reason } = req.body;
    await recordStepStatus(ticketId, pathId, stepId, req.user!, {
      status: String(status),
      reason: reason ? String(reason) : undefined
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
