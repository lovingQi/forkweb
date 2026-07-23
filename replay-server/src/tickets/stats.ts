import { getDb } from '../db';
import { readJsonStore } from '../db/jsonStore';
import type { KnowledgeHitsData } from '../core/knowledgeBase';
import type { KnowledgeLibrary, KnowledgeRule } from '../types';

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

interface DateRangeSql {
  where: string;
  values: string[];
}

function buildDateRangeSql(prefix: string, range?: DateRange): DateRangeSql {
  const where: string[] = [];
  const values: string[] = [];
  if (range?.startDate) {
    where.push(`${prefix}.created_at >= ?`);
    values.push(range.startDate);
  }
  if (range?.endDate) {
    where.push(`${prefix}.created_at < ?`);
    const nextDay = new Date(range.endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    values.push(nextDay.toISOString().slice(0, 10));
  }
  return { where: where.join(' AND '), values };
}

export interface StatusDistributionItem {
  status: string;
  count: number;
}

export interface TicketStats {
  totalTickets: number;
  statusDistribution: StatusDistributionItem[];
  selfServiceRate: number;
  selfServiceRateText: string;
  avgResolutionSeconds: number;
  avgResolutionText: string;
  bySite: { siteId: number | null; siteName: string; count: number }[];
  byIssueType: { issueType: string; count: number }[];
}

export async function getTicketStats(range?: DateRange): Promise<TicketStats> {
  const db = await getDb();
  const dateSql = buildDateRangeSql('t', range);
  const baseWhere = dateSql.where ? `WHERE ${dateSql.where}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) as c FROM tickets t ${baseWhere}`)
    .get(...dateSql.values) as { c: number };

  const statusRows = db
    .prepare(
      `SELECT t.status, COUNT(*) as c FROM tickets t ${baseWhere} GROUP BY t.status ORDER BY c DESC`
    )
    .all(...dateSql.values) as Array<{ status: string; c: number }>;

  const selfSolvedRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM tickets t WHERE t.status = 'self_solved' ${dateSql.where ? `AND ${dateSql.where}` : ''}`
    )
    .get(...dateSql.values) as { c: number };

  const resolvedRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM tickets t WHERE t.status = 'resolved' ${dateSql.where ? `AND ${dateSql.where}` : ''}`
    )
    .get(...dateSql.values) as { c: number };

  const selfServiceTotal = selfSolvedRow.c + resolvedRow.c;
  const selfServiceRate = selfServiceTotal > 0 ? selfSolvedRow.c / selfServiceTotal : 0;

  const avgRow = db
    .prepare(
      `SELECT AVG((julianday(t.resolved_at) - julianday(t.created_at)) * 86400) as avgSeconds
       FROM tickets t
       WHERE t.status = 'resolved' AND t.resolved_at IS NOT NULL
       ${dateSql.where ? `AND ${dateSql.where}` : ''}`
    )
    .get(...dateSql.values) as { avgSeconds: number | null };

  const avgResolutionSeconds = avgRow.avgSeconds ? Math.round(avgRow.avgSeconds) : 0;

  const bySite = await getTicketsBySite(range);
  const byIssueType = await getTicketsByIssueType(range);

  return {
    totalTickets: totalRow.c,
    statusDistribution: statusRows.map((r) => ({ status: r.status, count: r.c })),
    selfServiceRate,
    selfServiceRateText: `${(selfServiceRate * 100).toFixed(1)}%`,
    avgResolutionSeconds,
    avgResolutionText: formatDuration(avgResolutionSeconds),
    bySite,
    byIssueType
  };
}

export async function getTicketsBySite(range?: DateRange): Promise<{ siteId: number | null; siteName: string; count: number }[]> {
  const db = await getDb();
  const dateSql = buildDateRangeSql('t', range);
  const sql =
    `SELECT t.site_id as siteId, s.name as siteName, COUNT(*) as c
     FROM tickets t
     LEFT JOIN sites s ON t.site_id = s.id
     ${dateSql.where ? `WHERE ${dateSql.where}` : ''}
     GROUP BY t.site_id
     ORDER BY c DESC`;
  const rows = db.prepare(sql).all(...dateSql.values) as Array<{ siteId: number | null; siteName: string | null; c: number }>;
  return rows.map((r) => ({ siteId: r.siteId, siteName: r.siteName || '未分配现场', count: r.c }));
}

export async function getTicketsByIssueType(range?: DateRange): Promise<{ issueType: string; count: number }[]> {
  const db = await getDb();
  const dateSql = buildDateRangeSql('t', range);
  const sql =
    `SELECT COALESCE(t.issue_type, 'unknown') as issueType, COUNT(*) as c
     FROM tickets t
     ${dateSql.where ? `WHERE ${dateSql.where}` : ''}
     GROUP BY t.issue_type
     ORDER BY c DESC`;
  const rows = db.prepare(sql).all(...dateSql.values) as Array<{ issueType: string; c: number }>;
  return rows.map((r) => ({ issueType: r.issueType, count: r.c }));
}

export interface KnowledgeStats {
  totalRules: number;
  verifiedRules: number;
  coverageRate: number;
  coverageRateText: string;
  topRules: { id: string; title: string; hitCount: number; enabled: boolean }[];
  feedbackDistribution: { useful: number; partial: number; useless: number };
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  const library = await readJsonStore<KnowledgeLibrary>('knowledgeBase', { version: 1, updatedAt: '', rules: [] });
  const hitsData = await readJsonStore<KnowledgeHitsData>('knowledgeHits', { updatedAt: '', hits: {} });
  const rules = mergeHitsIntoRules(library.rules, hitsData);

  const totalRules = rules.length;
  const verifiedRules = rules.filter((r) => r.publicationStatus === 'verified').length;
  const coverageRate = totalRules > 0 ? verifiedRules / totalRules : 0;

  const topRules = rules
    .sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
    .slice(0, 10)
    .map((r) => ({ id: r.id, title: r.title, hitCount: r.hitCount || 0, enabled: r.enabled }));

  const feedbackDistribution = rules.reduce(
    (acc, r) => {
      acc.useful += r.feedbackStats?.useful || 0;
      acc.partial += r.feedbackStats?.partial || 0;
      acc.useless += r.feedbackStats?.useless || 0;
      return acc;
    },
    { useful: 0, partial: 0, useless: 0 }
  );

  return {
    totalRules,
    verifiedRules,
    coverageRate,
    coverageRateText: `${(coverageRate * 100).toFixed(1)}%`,
    topRules,
    feedbackDistribution
  };
}

function mergeHitsIntoRules(rules: KnowledgeRule[], hitsData: KnowledgeHitsData): KnowledgeRule[] {
  return rules.map((rule) => {
    const hit = hitsData.hits[rule.id];
    if (!hit) return rule;
    return { ...rule, hitCount: hit.hitCount || 0, recentHits: hit.recentHits || [] };
  });
}

export interface UserStats {
  afterSalesRanking: { userId: number; username: string; displayName: string | null; count: number }[];
  rdResolutionRanking: { userId: number; username: string; displayName: string | null; count: number }[];
}

export async function getUserStats(range?: DateRange): Promise<UserStats> {
  const db = await getDb();
  const dateSql = buildDateRangeSql('t', range);

  const afterSalesSql =
    `SELECT t.reporter_id as userId, u.username, u.display_name as displayName, COUNT(*) as c
     FROM tickets t
     JOIN users u ON t.reporter_id = u.id
     WHERE u.role = 'after_sales'
     ${dateSql.where ? `AND ${dateSql.where}` : ''}
     GROUP BY t.reporter_id
     ORDER BY c DESC`;

  const afterSalesRows = db
    .prepare(afterSalesSql)
    .all(...dateSql.values) as Array<{ userId: number; username: string; displayName: string | null; c: number }>;

  const rdSql =
    `SELECT t.assignee_id as userId, u.username, u.display_name as displayName, COUNT(*) as c
     FROM tickets t
     JOIN users u ON t.assignee_id = u.id
     WHERE t.status = 'resolved' AND t.assignee_id IS NOT NULL AND (u.role = 'rd' OR u.role = 'admin')
     ${dateSql.where ? `AND ${dateSql.where}` : ''}
     GROUP BY t.assignee_id
     ORDER BY c DESC`;

  const rdRows = db
    .prepare(rdSql)
    .all(...dateSql.values) as Array<{ userId: number; username: string; displayName: string | null; c: number }>;

  return {
    afterSalesRanking: afterSalesRows.map((r) => ({ userId: r.userId, username: r.username, displayName: r.displayName, count: r.c })),
    rdResolutionRanking: rdRows.map((r) => ({ userId: r.userId, username: r.username, displayName: r.displayName, count: r.c }))
  };
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '无数据';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (parts.length === 0) parts.push('不足1分钟');
  return parts.join('');
}
