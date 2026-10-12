import crypto from 'crypto';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../auth/middleware';
import { getOpenApiKey, isOpenApiEnabled } from './config';
import { getOpenApiActor } from './systemUser';

function safeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    crypto.timingSafeEqual(leftBuf, leftBuf);
    return false;
  }
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

export async function openApiAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isOpenApiEnabled()) {
    res.status(503).json({ succeed: false, code: 'OPEN_API_DISABLED', error: '对外接口未启用' });
    return;
  }
  const provided = String(req.headers['x-api-key'] || '');
  if (!provided || !safeEqual(provided, getOpenApiKey())) {
    res.status(401).json({ succeed: false, code: 'INVALID_API_KEY', error: 'API Key 无效' });
    return;
  }
  const actor = await getOpenApiActor();
  if (!actor) {
    res.status(403).json({ succeed: false, code: 'SYSTEM_USER_DISABLED', error: '对接系统账号不可用' });
    return;
  }
  req.user = actor;
  next();
}
