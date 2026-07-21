import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth/middleware';
import { createSite, deleteSite, getSiteById, listSites, updateSite } from '../db/sites';
import { getDb } from '../db/index';

const router = Router();

function serializeSite(site: Awaited<ReturnType<typeof getSiteById>>) {
  if (!site) return null;
  return {
    id: site.id,
    name: site.name,
    createdAt: site.created_at,
    updatedAt: site.updated_at
  };
}

// 所有登录用户可读
router.get('/', authMiddleware, async (_req, res) => {
  try {
    const sites = await listSites();
    res.json({ succeed: true, sites: sites.map(serializeSite) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// rd / admin 可创建
router.post('/', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      res.status(400).json({ succeed: false, error: '现场名称不能为空' });
      return;
    }
    const site = await createSite({ name });
    res.json({ succeed: true, site: serializeSite(site) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// rd / admin 可编辑
router.put('/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!name) {
      res.status(400).json({ succeed: false, error: '现场名称不能为空' });
      return;
    }
    const site = await updateSite(id, { name });
    if (!site) {
      res.status(404).json({ succeed: false, error: '现场不存在' });
      return;
    }
    res.json({ succeed: true, site: serializeSite(site) });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// rd / admin 可删除；若仍有工单引用则禁止删除
router.delete('/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM tickets WHERE site_id = ?').get(id) as { c: number };
    if (count.c > 0) {
      res.status(400).json({ succeed: false, error: `该现场已被 ${count.c} 个工单使用，无法删除` });
      return;
    }
    const deleted = await deleteSite(id);
    if (!deleted) {
      res.status(404).json({ succeed: false, error: '现场不存在' });
      return;
    }
    res.json({ succeed: true });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
