import fs from 'fs/promises';
import path from 'path';
import { listTicketsWithAnalysisCompletedBefore } from '../db/tickets';
import { cleanupExpiredTempFiles } from '../upload/tempFiles';
import { CACHE_DIR } from '../paths';

const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PENDING_DIR_NAME = 'pending';

export interface StorageCleanupResult {
  cleanedTicketLogDirs: number;
  cleanedUploadTempFiles: number;
  cleanedPendingTempFiles: number;
  errors: string[];
}

function expiredBefore(): string {
  return new Date(Date.now() - RETENTION_MS).toISOString().slice(0, 19).replace('T', ' ');
}

export async function cleanExpiredFiles(): Promise<StorageCleanupResult> {
  const result: StorageCleanupResult = {
    cleanedTicketLogDirs: 0,
    cleanedUploadTempFiles: 0,
    cleanedPendingTempFiles: 0,
    errors: []
  };
  const tickets = await listTicketsWithAnalysisCompletedBefore(expiredBefore());

  for (const ticket of tickets) {
    try {
      await fs.rm(ticket.log_dir, { recursive: true, force: true });
      result.cleanedTicketLogDirs += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`工单 ${ticket.id} 原始日志清理失败: ${message}`);
      console.error('[storage-cleaner]', result.errors.at(-1));
    }
  }

  const uploadsDir = path.join(CACHE_DIR, 'uploads');
  try {
    const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      const filePath = path.join(uploadsDir, entry.name);
      // pending 目录由 cleanupExpiredTempFiles 单独管理（24 小时 TTL）
      if (entry.isDirectory() && entry.name === PENDING_DIR_NAME) continue;
      try {
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs <= RETENTION_MS) continue;
        await fs.rm(filePath, { recursive: entry.isDirectory(), force: true });
        result.cleanedUploadTempFiles += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`上传临时文件 ${entry.name} 清理失败: ${message}`);
        console.error('[storage-cleaner]', result.errors.at(-1));
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`读取上传临时目录失败: ${message}`);
      console.error('[storage-cleaner]', result.errors.at(-1));
    }
  }

  try {
    result.cleanedPendingTempFiles = await cleanupExpiredTempFiles();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`清理预上传临时文件失败: ${message}`);
    console.error('[storage-cleaner]', result.errors.at(-1));
  }

  return result;
}
