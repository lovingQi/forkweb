import fs from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
import tar from 'tar';
import { CACHE_DIR } from '../paths';
import fsSync from 'fs';

const UPLOAD_BASE = path.join(CACHE_DIR, 'tickets');

export function getTicketDir(ticketId: number): string {
  return path.join(UPLOAD_BASE, String(ticketId));
}

export function getTicketLogDir(ticketId: number): string {
  return path.join(getTicketDir(ticketId), 'logs');
}

export function getTicketMapDir(ticketId: number): string {
  return path.join(getTicketDir(ticketId), 'maps');
}

export function getTicketWorkDir(ticketId: number): string {
  return path.join(getTicketDir(ticketId), 'work');
}

export async function ensureTicketDirs(ticketId: number): Promise<void> {
  await fs.mkdir(getTicketLogDir(ticketId), { recursive: true });
  await fs.mkdir(getTicketMapDir(ticketId), { recursive: true });
  await fs.mkdir(getTicketWorkDir(ticketId), { recursive: true });
}

export async function cleanTicketDirs(ticketId: number): Promise<void> {
  await fs.rm(getTicketLogDir(ticketId), { recursive: true, force: true });
  await fs.rm(getTicketMapDir(ticketId), { recursive: true, force: true });
  await fs.rm(getTicketWorkDir(ticketId), { recursive: true, force: true });
}

const ARCHIVE_EXTENSIONS = ['.zip', '.tar.gz', '.tgz'];

function isArchive(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function extractArchive(archivePath: string, destDir: string, originalName?: string): Promise<void> {
  const lower = (originalName || archivePath).toLowerCase();
  if (lower.endsWith('.zip')) {
    await new Promise<void>((resolve, reject) => {
      fsSync.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: destDir }))
        .on('close', resolve)
        .on('error', reject);
    });
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await tar.x({ file: archivePath, cwd: destDir });
  } else {
    throw new Error(`不支持的压缩格式: ${originalName || archivePath}`);
  }
}

async function flattenSingleDir(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const nested = path.join(dir, entries[0].name);
    const nestedEntries = await fs.readdir(nested);
    for (const name of nestedEntries) {
      await fs.rename(path.join(nested, name), path.join(dir, name));
    }
    await fs.rmdir(nested);
  }
}

async function walk(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(fullPath);
      results.push(...nested);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

export interface ProcessUploadResult {
  logDir: string;
  mapDir: string | undefined;
  mapFile: string | undefined;
  logCount: number;
}

export async function processUploadFiles(
  ticketId: number,
  filePaths: string[],
  originalNames?: string[]
): Promise<ProcessUploadResult> {
  const logDir = getTicketLogDir(ticketId);
  const mapDir = getTicketMapDir(ticketId);
  const workDir = getTicketWorkDir(ticketId);

  console.error('[upload] start processUploadFiles', { ticketId, filePaths, workDir });

  await cleanTicketDirs(ticketId);
  await fs.mkdir(logDir, { recursive: true });
  await fs.mkdir(mapDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });

  // 1. 把所有原始文件放入 workDir，压缩包解压到 workDir
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const originalName = originalNames?.[i] || path.basename(filePath);
    if (isArchive(originalName)) {
      const extractDir = path.join(workDir, path.basename(originalName) + '.extracted');
      await fs.mkdir(extractDir, { recursive: true });
      await extractArchive(filePath, extractDir, originalName);
      await flattenSingleDir(extractDir);
    } else {
      const dest = path.join(workDir, path.basename(originalName));
      await fs.copyFile(filePath, dest);
    }
  }

  // 2. 递归扫描 workDir，按扩展名归类
  let logCount = 0;
  let mapFile: string | undefined;
  const allFiles = await walk(workDir);
  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.log') {
      const dest = path.join(logDir, path.basename(filePath));
      await fs.copyFile(filePath, dest);
      logCount++;
    } else if (ext === '.json') {
      const dest = path.join(mapDir, path.basename(filePath));
      await fs.copyFile(filePath, dest);
      if (!mapFile) {
        mapFile = dest;
      }
    }
  }

  // 3. 清理临时工作区
  await fs.rm(workDir, { recursive: true, force: true });

  return {
    logDir,
    mapDir: mapFile ? mapDir : undefined,
    mapFile,
    logCount
  };
}

// 兼容旧接口：单个压缩包作为日志来源
export async function extractLogArchive(ticketId: number, archivePath: string, originalName?: string): Promise<string> {
  const { logDir, logCount } = await processUploadFiles(ticketId, [archivePath], originalName ? [originalName] : undefined);
  if (logCount === 0) {
    throw new Error(`压缩包中未找到 .log 日志文件: ${originalName || archivePath}`);
  }
  return logDir;
}

export async function saveMapFile(ticketId: number, mapPath: string): Promise<string> {
  const mapDir = getTicketMapDir(ticketId);
  await fs.mkdir(mapDir, { recursive: true });
  const dest = path.join(mapDir, path.basename(mapPath));
  await fs.copyFile(mapPath, dest);
  return dest;
}
