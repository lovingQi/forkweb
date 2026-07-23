import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth/middleware';
import {
  createCategory,
  listCategories,
  updateCategory,
  deleteCategory
} from '../db/vehicleCategories';
import {
  createModel,
  listModelsByCategoryId,
  listAllModels,
  updateModel,
  deleteModel,
  getModelById,
  listModelsBySiteId
} from '../db/vehicleModels';

const router = Router();

// ── 车型类别 ────────────────────────────────────────

router.get('/categories', authMiddleware, async (_req, res) => {
  try {
    const categories = await listCategories();
    res.json({ succeed: true, categories });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/categories', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      res.status(400).json({ succeed: false, error: '类别名称不能为空' });
      return;
    }
    const category = await createCategory(name);
    res.json({ succeed: true, category });
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ succeed: false, error: '类别名称已存在' });
      return;
    }
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.put('/categories/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!name) {
      res.status(400).json({ succeed: false, error: '类别名称不能为空' });
      return;
    }
    const category = await updateCategory(id, name);
    if (!category) {
      res.status(404).json({ succeed: false, error: '类别不存在' });
      return;
    }
    res.json({ succeed: true, category });
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ succeed: false, error: '类别名称已存在' });
      return;
    }
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete('/categories/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await deleteCategory(id);
    if (!result.deleted) {
      res.status(400).json({ succeed: false, error: result.reason || '删除失败' });
      return;
    }
    res.json({ succeed: true });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── 车型型号 ────────────────────────────────────────

router.get('/models', authMiddleware, async (req, res) => {
  try {
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    const siteId = req.query.siteId ? Number(req.query.siteId) : undefined;
    if (siteId) {
      const models = await listModelsBySiteId(siteId);
      res.json({ succeed: true, models });
      return;
    }
    if (categoryId) {
      const models = await listModelsByCategoryId(categoryId);
      res.json({ succeed: true, models });
      return;
    }
    const models = await listAllModels();
    res.json({ succeed: true, models });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/models/:id', authMiddleware, async (req, res) => {
  try {
    const model = await getModelById(Number(req.params.id));
    if (!model) {
      res.status(404).json({ succeed: false, error: '型号不存在' });
      return;
    }
    res.json({ succeed: true, model });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/models', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const categoryId = Number(req.body.categoryId);
    const name = String(req.body.name || '').trim();
    if (!categoryId || !name) {
      res.status(400).json({ succeed: false, error: '类别和型号名称不能为空' });
      return;
    }
    const model = await createModel(categoryId, name);
    res.json({ succeed: true, model });
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ succeed: false, error: '该类别下已存在同名型号' });
      return;
    }
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.put('/models/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!name) {
      res.status(400).json({ succeed: false, error: '型号名称不能为空' });
      return;
    }
    const model = await updateModel(id, name);
    if (!model) {
      res.status(404).json({ succeed: false, error: '型号不存在' });
      return;
    }
    res.json({ succeed: true, model });
  } catch (e: any) {
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ succeed: false, error: '该类别下已存在同名型号' });
      return;
    }
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete('/models/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await deleteModel(id);
    if (!result.deleted) {
      res.status(400).json({ succeed: false, error: result.reason || '删除失败' });
      return;
    }
    res.json({ succeed: true });
  } catch (e) {
    res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
