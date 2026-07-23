import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth/middleware';
import { getKnowledgeStats, getTicketStats, getUserStats } from '../tickets/stats';

const router = Router();

function parseDateRange(req: any) {
  const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
  const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
  return { startDate, endDate };
}

router.get(
  '/tickets',
  authMiddleware,
  requireRole('admin', 'rd'),
  async (req, res) => {
    try {
      const stats = await getTicketStats(parseDateRange(req));
      res.json({ succeed: true, stats });
    } catch (e) {
      res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.get(
  '/knowledge',
  authMiddleware,
  requireRole('admin', 'rd'),
  async (_req, res) => {
    try {
      const stats = await getKnowledgeStats();
      res.json({ succeed: true, stats });
    } catch (e) {
      res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.get(
  '/users',
  authMiddleware,
  requireRole('admin', 'rd'),
  async (req, res) => {
    try {
      const stats = await getUserStats(parseDateRange(req));
      res.json({ succeed: true, stats });
    } catch (e) {
      res.status(500).json({ succeed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
);

export default router;
