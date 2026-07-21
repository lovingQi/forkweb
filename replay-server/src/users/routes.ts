import { Router } from 'express';
import { hashPassword } from '../auth/password';
import { authMiddleware, requireRole, signToken, type AuthRequest } from '../auth/middleware';
import { countUsers, createUser, getUserByUsername, listUsers } from '../db/users';
import { verifyPassword } from '../auth/password';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ succeed: false, error: '用户名和密码不能为空' });
      return;
    }
    const user = await getUserByUsername(String(username));
    if (!user || !(await verifyPassword(String(password), user.password_hash))) {
      res.status(401).json({ succeed: false, error: '用户名或密码错误' });
      return;
    }
    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      email: user.email
    });
    res.json({
      succeed: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        email: user.email
      }
    });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ succeed: true, user: req.user });
});

router.get('/users', authMiddleware, requireRole('admin'), async (_req, res) => {
  try {
    const users = await listUsers();
    res.json({
      succeed: true,
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        displayName: u.display_name,
        email: u.email,
        createdAt: u.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/users', authMiddleware, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { username, password, role, displayName, email } = req.body;
    if (!username || !password || !role) {
      res.status(400).json({ succeed: false, error: '用户名、密码、角色不能为空' });
      return;
    }
    if (!['after_sales', 'rd', 'admin'].includes(role)) {
      res.status(400).json({ succeed: false, error: '角色无效' });
      return;
    }
    const existing = await getUserByUsername(String(username));
    if (existing) {
      res.status(409).json({ succeed: false, error: '用户名已存在' });
      return;
    }
    const passwordHash = await hashPassword(String(password));
    const user = await createUser({
      username: String(username),
      passwordHash,
      role,
      displayName: displayName ? String(displayName) : undefined,
      email: email ? String(email) : undefined
    });
    res.json({
      succeed: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        email: user.email
      }
    });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export async function ensureAdminUser(): Promise<void> {
  const count = await countUsers();
  if (count > 0) return;
  const passwordHash = await hashPassword('admin123');
  await createUser({
    username: 'admin',
    passwordHash,
    role: 'admin',
    displayName: '系统管理员',
    email: ''
  });
  console.log('[auth] 已创建默认管理员账号: admin / admin123');
}

export default router;
