import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import type { NextFunction, Response } from 'express';
import { CACHE_DIR } from '../paths';
import type { AuthRequest } from '../auth/middleware';
import { getTicketByNo } from '../db/tickets';
import { openApiAuth } from './apiKeyAuth';
import { createExternalTicket, OpenApiError } from './service';

const router = Router();
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;

const upload = multer({
  dest: path.join(CACHE_DIR, 'uploads'),
  limits: { fileSize: MAX_SINGLE_FILE_BYTES }
});

async function removeUploadedTempFiles(req: AuthRequest): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  await Promise.all(files.map((file) => fs.rm(file.path, { force: true }).catch(() => undefined)));
}

function uploadOpenFiles(req: AuthRequest, res: Response, next: NextFunction): void {
  upload.array('files', 20)(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    void removeUploadedTempFiles(req).finally(() => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ succeed: false, code: 'FILE_TOO_LARGE', error: '单个上传文件不能超过 50MB' });
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
        res.status(400).json({ succeed: false, code: 'VALIDATION_ERROR', error: '单次最多上传 20 个文件' });
        return;
      }
      res.status(400).json({
        succeed: false,
        code: 'VALIDATION_ERROR',
        error: error instanceof Error ? error.message : '文件上传失败'
      });
    });
  });
}

function serializeOpenTicket(ticket: { ticket_no: string; external_id: string | null; status: string; created_at: string }) {
  return {
    ticketNo: ticket.ticket_no,
    externalId: ticket.external_id,
    status: ticket.status,
    createdAt: ticket.created_at
  };
}

router.post('/tickets', openApiAuth, uploadOpenFiles, async (req: AuthRequest, res) => {
  try {
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];
    if (uploadedFiles.length === 0) {
      throw new OpenApiError(400, 'NO_FILES', '请至少上传一个文件');
    }
    const oversized = uploadedFiles.find((file) => file.size > MAX_SINGLE_FILE_BYTES);
    if (oversized) {
      throw new OpenApiError(413, 'FILE_TOO_LARGE', `单个上传文件不能超过 50MB（${oversized.originalname}）`);
    }
    const total = uploadedFiles.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_UPLOAD_BYTES) {
      throw new OpenApiError(413, 'FILE_TOO_LARGE', '所有上传文件总大小不能超过 200MB');
    }

    const aiRaw = req.body.aiEnabled;
    const result = await createExternalTicket({
      actor: req.user!,
      externalId: String(req.body.externalId || ''),
      title: String(req.body.title || ''),
      description: String(req.body.description || ''),
      siteName: req.body.siteName ? String(req.body.siteName) : undefined,
      vehicleModelName: req.body.vehicleModelName ? String(req.body.vehicleModelName) : undefined,
      vehicleCategoryName: req.body.vehicleCategoryName ? String(req.body.vehicleCategoryName) : undefined,
      impactLevel: req.body.impactLevel ? String(req.body.impactLevel) : undefined,
      occurredStartAt: req.body.occurredStartAt ? String(req.body.occurredStartAt) : undefined,
      occurredEndAt: req.body.occurredEndAt ? String(req.body.occurredEndAt) : undefined,
      aiEnabled: !(aiRaw === 'false' || aiRaw === false),
      filePaths: uploadedFiles.map((file) => file.path),
      originalNames: uploadedFiles.map((file) => file.originalname)
    });

    res.json({
      succeed: true,
      duplicated: result.duplicated,
      ticket: serializeOpenTicket(result.ticket),
      matches: result.matches,
      warnings: result.warnings
    });
  } catch (error) {
    if (error instanceof OpenApiError) {
      res.status(error.status).json({ succeed: false, code: error.code, error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('未找到 .log')) {
      res.status(400).json({ succeed: false, code: 'NO_LOG_FILE', error: message });
      return;
    }
    res.status(500).json({ succeed: false, code: 'INTERNAL_ERROR', error: message });
  } finally {
    await removeUploadedTempFiles(req);
  }
});

router.get('/tickets/:ticketNo/report', openApiAuth, async (req, res) => {
  try {
    const ticket = await getTicketByNo(String(req.params.ticketNo || '').trim());
    if (!ticket || !ticket.external_id) {
      res.status(404).json({ succeed: false, code: 'NOT_FOUND', error: '工单不存在' });
      return;
    }
    if (!ticket.report_path) {
      res.status(404).json({ succeed: false, code: 'NOT_FOUND', error: '报告尚未生成' });
      return;
    }
    const content = await fs.readFile(ticket.report_path, 'utf8');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(content);
  } catch (error) {
    res.status(500).json({
      succeed: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get('/tickets/:ticketNo/package', openApiAuth, async (req, res) => {
  try {
    const ticket = await getTicketByNo(String(req.params.ticketNo || '').trim());
    if (!ticket || !ticket.external_id) {
      res.status(404).json({ succeed: false, code: 'NOT_FOUND', error: '工单不存在' });
      return;
    }
    if (!ticket.package_path) {
      res.status(404).json({ succeed: false, code: 'NOT_FOUND', error: '诊断包尚未生成' });
      return;
    }
    await fs.access(ticket.package_path);
    const filename = `${ticket.ticket_no}-package.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(ticket.package_path);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'ENOENT') {
      res.status(404).json({ succeed: false, code: 'NOT_FOUND', error: '诊断包尚未生成' });
      return;
    }
    res.status(500).json({
      succeed: false,
      code: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
