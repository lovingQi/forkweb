import { getDb } from './index';

export interface DbAnalysisVersion {
  id: number;
  ticket_id: number;
  version_no: number;
  input_log_dir: string;
  input_map_dir: string | null;
  input_map_file: string | null;
  input_package_source: string | null;
  occurred_start_at: string | null;
  occurred_end_at: string | null;
  issue_type: string | null;
  top_issues: string;
  troubleshooting_paths_snapshot: string | null;
  evidence_summary: string | null;
  report_path: string | null;
  package_path: string | null;
  created_at: string;
}

export interface CreateAnalysisVersionInput {
  ticketId: number;
  inputLogDir: string;
  inputMapDir?: string;
  inputMapFile?: string;
  inputPackageSource?: string;
  occurredStartAt?: string;
  occurredEndAt?: string;
  issueType?: string;
  topIssues: unknown[];
  troubleshootingPathsSnapshot?: unknown;
  evidenceSummary?: unknown;
  reportPath?: string;
  packagePath?: string;
}

export async function createAnalysisVersion(input: CreateAnalysisVersionInput): Promise<DbAnalysisVersion> {
  const db = await getDb();
  const nextVersion = db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 as next FROM ticket_analysis_versions WHERE ticket_id = ?')
    .get(input.ticketId) as { next: number };

  const stmt = db.prepare(
    `INSERT INTO ticket_analysis_versions (
      ticket_id, version_no, input_log_dir, input_map_dir, input_map_file, input_package_source,
      occurred_start_at, occurred_end_at, issue_type, top_issues, troubleshooting_paths_snapshot,
      evidence_summary, report_path, package_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.ticketId,
    nextVersion.next,
    input.inputLogDir,
    input.inputMapDir ?? null,
    input.inputMapFile ?? null,
    input.inputPackageSource ?? null,
    input.occurredStartAt ?? null,
    input.occurredEndAt ?? null,
    input.issueType ?? null,
    JSON.stringify(input.topIssues),
    input.troubleshootingPathsSnapshot ? JSON.stringify(input.troubleshootingPathsSnapshot) : null,
    input.evidenceSummary ? JSON.stringify(input.evidenceSummary) : null,
    input.reportPath ?? null,
    input.packagePath ?? null
  );
  return getAnalysisVersionById(Number(result.lastInsertRowid)) as Promise<DbAnalysisVersion>;
}

export async function getAnalysisVersionById(id: number): Promise<DbAnalysisVersion | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_analysis_versions WHERE id = ?').get(id) as DbAnalysisVersion | undefined;
}

export async function listAnalysisVersions(ticketId: number): Promise<DbAnalysisVersion[]> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_analysis_versions WHERE ticket_id = ? ORDER BY version_no DESC').all(ticketId) as DbAnalysisVersion[];
}

export async function getLatestAnalysisVersion(ticketId: number): Promise<DbAnalysisVersion | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_analysis_versions WHERE ticket_id = ? ORDER BY version_no DESC LIMIT 1')
    .get(ticketId) as DbAnalysisVersion | undefined;
}

export async function deleteAnalysisVersionsByTicketId(ticketId: number): Promise<void> {
  const db = await getDb();
  db.prepare('DELETE FROM ticket_analysis_versions WHERE ticket_id = ?').run(ticketId);
}
