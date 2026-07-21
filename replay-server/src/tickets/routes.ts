import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { CACHE_DIR } from '../paths';
import { authMiddleware, requireRole, type AuthRequest } from '../auth/middleware';
import type { DbTicket, TicketStatus } from '../db/tickets';
import {
  assignTicket,
  createKnowledgeFromTicket,
  createTicketWithUploads,
  getTicketDetail,
  listUserTickets,
  resolveTicket,
  startTicketAnalysis,
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
  upload.fields([
    { name: 'logs', maxCount: 1 },
    { name: 'map', maxCount: 1 }
  ]),
  async (req: AuthRequest, res) => {
    try {
      const title = String(req.body.title || '').trim();
      const description = String(req.body.description || '').trim();
      if (!title || !description) {
        res.status(400).json({ succeed: false, error: '标题和描述不能为空' });
        return;
      }

      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const logFile = files?.logs?.[0];
      if (!logFile) {
        res.status(400).json({ succeed: false, error: '日志压缩包必须上传' });
        return;
      }

      const mapFile = files?.map?.[0];
      const aiEnabled = req.body.aiEnabled === 'true' || req.body.aiEnabled === true;

      const ticket = await createTicketWithUploads({
        title,
        description,
        logArchivePath: logFile.path,
        logOriginalName: logFile.originalname,
        mapFilePath: mapFile?.path,
        reporter: req.user!,
        aiEnabled
      });

      // 清理上传临时文件
      await fs.rm(logFile.path, { force: true });
      if (mapFile) await fs.rm(mapFile.path, { force: true });

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
    const tickets = await listUserTickets(req.user!, {
      status,
      reporterId: Number.isFinite(reporterId) ? reporterId : undefined
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
    'analyzed',
    'verifying',
    'resolved',
    'needs_rd'
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

// 售后验证
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
  const withReporter = ticket as DbTicket & { reporter_username?: string };
  return {
    id: ticket.id,
    ticketNo: ticket.ticket_no,
    title: ticket.title,
    description: ticket.description,
    reporterId: ticket.reporter_id,
    reporterName: withReporter.reporter_username || '',
    assigneeId: ticket.assignee_id,
    status: ticket.status,
    conclusion: ticket.conclusion,
    reportPath: ticket.report_path,
    packagePath: ticket.package_path,
    logDir: ticket.log_dir,
    mapDir: ticket.map_dir,
    mapFile: ticket.map_file,
    aiEnabled: ticket.ai_enabled === 1,
    aiConclusion: ticket.ai_conclusion,
    aiOffline: ticket.ai_offline === 1,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at
  };
}

export default router;
