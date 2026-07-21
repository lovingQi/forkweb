import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getUserById } from '../db/users';

export type UserRole = 'after_sales' | 'rd' | 'admin';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  displayName: string | null;
  email: string | null;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

const JWT_SECRET = process.env.JWT_SECRET || 'forkweb-dev-secret-change-in-production';

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser & { iat: number; exp: number };
    return {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      displayName: payload.displayName,
      email: payload.email
    };
  } catch {
    return null;
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? verifyToken(token) : null;
  if (!user) {
    res.status(401).json({ succeed: false, error: '未登录或 token 已过期' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ succeed: false, error: '未登录' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ succeed: false, error: '权限不足' });
      return;
    }
    next();
  };
}

export async function refreshUser(userId: number): Promise<AuthUser | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role as UserRole,
    displayName: user.display_name,
    email: user.email
  };
}
