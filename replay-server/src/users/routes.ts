import { Router } from 'express';
import { hashPassword } from '../auth/password';
import { authMiddleware, requireRole, signToken, type AuthRequest } from '../auth/middleware';
import { countUsers, createUser, deleteUser, getUserById, getUserByUsername, listUsers, updateUser } from '../db/users';
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
    if (user.disabled) {
      res.status(401).json({ succeed: false, error: '账号已被禁用' });
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
        disabled: u.disabled === 1,
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
      user: serializeUser(user)
    });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.put('/users/:id', authMiddleware, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    const target = await getUserById(userId);
    if (!target) {
      res.status(404).json({ succeed: false, error: '用户不存在' });
      return;
    }

    const { role, displayName, email, disabled, password } = req.body;
    const update: Parameters<typeof updateUser>[1] = {};
    if (role !== undefined) {
      if (!['after_sales', 'rd', 'admin'].includes(role)) {
        res.status(400).json({ succeed: false, error: '角色无效' });
        return;
      }
      update.role = role;
    }
    if (displayName !== undefined) update.displayName = String(displayName);
    if (email !== undefined) update.email = String(email);
    if (disabled !== undefined) update.disabled = Boolean(disabled);
    if (password !== undefined && String(password).trim()) {
      update.passwordHash = await hashPassword(String(password));
    }

    if (update.role === 'after_sales' || update.role === 'rd' || update.disabled === true) {
      if (target.role === 'admin' && !(await hasOtherAdmin(userId))) {
        res.status(400).json({ succeed: false, error: '不能降级或禁用最后一个管理员' });
        return;
      }
    }

    const user = await updateUser(userId, update);
    res.json({ succeed: true, user: serializeUser(user!) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    const target = await getUserById(userId);
    if (!target) {
      res.status(404).json({ succeed: false, error: '用户不存在' });
      return;
    }
    if (target.role === 'admin' && !(await hasOtherAdmin(userId))) {
      res.status(400).json({ succeed: false, error: '不能删除最后一个管理员' });
      return;
    }
    await deleteUser(userId);
    res.json({ succeed: true });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

async function hasOtherAdmin(excludeUserId: number): Promise<boolean> {
  const users = await listUsers();
  return users.some((u) => u.id !== excludeUserId && u.role === 'admin' && !u.disabled);
}

function serializeUser(user: { id: number; username: string; role: string; display_name: string | null; email: string | null; disabled?: number }) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    email: user.email,
    disabled: user.disabled === 1
  };
}

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
