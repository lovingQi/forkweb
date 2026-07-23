import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CACHE_DIR } from '../paths';

const PENDING_DIR = path.join(CACHE_DIR, 'uploads', 'pending');
const META_FILE = path.join(PENDING_DIR, 'meta.json');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingTempFile {
  tempFileId: string;
  path: string;
  originalName: string;
  size: number;
  createdAt: string;
  uploadedBy: number;
}

interface PendingMeta {
  files: PendingTempFile[];
}

async function ensurePendingDir(): Promise<void> {
  await fs.mkdir(PENDING_DIR, { recursive: true });
}

async function readMeta(): Promise<PendingMeta> {
  try {
    const raw = await fs.readFile(META_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PendingMeta;
    return { files: Array.isArray(parsed.files) ? parsed.files : [] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { files: [] };
    }
    throw e;
  }
}

async function writeMeta(meta: PendingMeta): Promise<void> {
  await fs.mkdir(path.dirname(META_FILE), { recursive: true });
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

export async function saveTempFile(
  tempPath: string,
  originalName: string,
  size: number,
  uploadedBy: number
): Promise<PendingTempFile> {
  await ensurePendingDir();
  const tempFileId = uuidv4();
  const dest = path.join(PENDING_DIR, tempFileId);
  await fs.rename(tempPath, dest);

  const record: PendingTempFile = {
    tempFileId,
    path: dest,
    originalName,
    size,
    createdAt: new Date().toISOString(),
    uploadedBy
  };

  const meta = await readMeta();
  meta.files.push(record);
  await writeMeta(meta);
  return record;
}

export async function getTempFiles(tempFileIds: string[]): Promise<PendingTempFile[]> {
  const meta = await readMeta();
  const found = new Map<string, PendingTempFile>();
  for (const id of tempFileIds) {
    const record = meta.files.find((f) => f.tempFileId === id);
    if (record) {
      found.set(id, record);
    }
  }
  return tempFileIds.map((id) => found.get(id)).filter(Boolean) as PendingTempFile[];
}

export async function deleteTempFile(tempFileId: string): Promise<void> {
  const meta = await readMeta();
  const index = meta.files.findIndex((f) => f.tempFileId === tempFileId);
  if (index === -1) return;

  const record = meta.files[index];
  meta.files.splice(index, 1);
  await writeMeta(meta);
  await fs.rm(record.path, { force: true }).catch(() => undefined);
}

export async function cleanupExpiredTempFiles(maxAgeMs: number = DEFAULT_TTL_MS): Promise<number> {
  await ensurePendingDir();
  const meta = await readMeta();
  const now = Date.now();
  const survivors: PendingTempFile[] = [];
  const expired: PendingTempFile[] = [];

  for (const record of meta.files) {
    if (now - new Date(record.createdAt).getTime() > maxAgeMs) {
      expired.push(record);
    } else {
      survivors.push(record);
    }
  }

  if (expired.length > 0) {
    await writeMeta({ files: survivors });
    await Promise.all(expired.map((r) => fs.rm(r.path, { force: true }).catch(() => undefined)));
  }

  return expired.length;
}
