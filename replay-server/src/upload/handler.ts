import fs from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
import tar from 'tar';

const UPLOAD_BASE = path.resolve(process.cwd(), 'replay-server/.cache/tickets');

export function getTicketDir(ticketId: number): string {
  return path.join(UPLOAD_BASE, String(ticketId));
}

export function getTicketLogDir(ticketId: number): string {
  return path.join(getTicketDir(ticketId), 'logs');
}

export function getTicketMapDir(ticketId: number): string {
  return path.join(getTicketDir(ticketId), 'maps');
}

export async function ensureTicketDirs(ticketId: number): Promise<void> {
  await fs.mkdir(getTicketLogDir(ticketId), { recursive: true });
  await fs.mkdir(getTicketMapDir(ticketId), { recursive: true });
}

export async function extractLogArchive(ticketId: number, archivePath: string, originalName?: string): Promise<string> {
  const logDir = getTicketLogDir(ticketId);
  await fs.rm(logDir, { recursive: true, force: true });
  await fs.mkdir(logDir, { recursive: true });

  const name = (originalName || archivePath).toLowerCase();
  if (name.endsWith('.zip')) {
    await new Promise<void>((resolve, reject) => {
      fsSync.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: logDir }))
        .on('close', resolve)
        .on('error', reject);
    });
  } else if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
    await tar.x({ file: archivePath, cwd: logDir });
  } else {
    throw new Error(`不支持的日志压缩格式: ${originalName || archivePath}`);
  }

  // 如果解压后只有一层目录，把内容提升到 logs/ 根下
  const entries = await fs.readdir(logDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const nested = path.join(logDir, entries[0].name);
    const nestedEntries = await fs.readdir(nested);
    for (const name of nestedEntries) {
      await fs.rename(path.join(nested, name), path.join(logDir, name));
    }
    await fs.rmdir(nested);
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

import fsSync from 'fs';
