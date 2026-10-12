import crypto from 'crypto';
import { hashPassword } from '../auth/password';
import type { AuthUser } from '../auth/middleware';
import { createUser, getUserByUsername } from '../db/users';
import { getOpenApiKey, getOpenApiUsername, isOpenApiEnabled } from './config';

export async function ensureOpenApiUser(): Promise<void> {
  if (!isOpenApiEnabled()) return;
  const key = getOpenApiKey();
  if (key.length < 32) {
    console.warn('[openapi] FORKWEB_OPEN_API_KEY 长度不足 32 位，建议更换为更长的随机字符串');
  }
  const username = getOpenApiUsername();
  const existing = await getUserByUsername(username);
  if (existing) return;
  const passwordHash = await hashPassword(crypto.randomBytes(24).toString('hex'));
  await createUser({
    username,
    passwordHash,
    role: 'after_sales',
    displayName: '售后AI系统',
    email: ''
  });
  console.log(`[openapi] 已创建对接系统账号: ${username}`);
}

export async function getOpenApiActor(): Promise<AuthUser | null> {
  const user = await getUserByUsername(getOpenApiUsername());
  if (!user || user.disabled) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    email: user.email
  };
}
