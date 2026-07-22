import { getDb } from './index';

export type TroubleshootingStepType = 'readonly_check' | 'field_operation' | 'rd_required';

export interface DbTroubleshootingStep {
  id: number;
  path_id: number;
  step_no: number;
  title: string;
  instruction: string | null;
  criteria: string | null;
  step_type: TroubleshootingStepType;
  estimated_time: string | null;
  evidence_config: string | null;
  is_critical: number;
  failure_action: string | null;
  created_at: string;
}

export interface CreateTroubleshootingStepInput {
  pathId: number;
  stepNo: number;
  title: string;
  instruction?: string;
  criteria?: string;
  stepType: TroubleshootingStepType;
  estimatedTime?: string;
  evidenceConfig?: Record<string, unknown>;
  isCritical?: boolean;
  failureAction?: string;
}

export async function createTroubleshootingStep(input: CreateTroubleshootingStepInput): Promise<DbTroubleshootingStep> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO ticket_troubleshooting_steps (
      path_id, step_no, title, instruction, criteria, step_type, estimated_time, evidence_config, is_critical, failure_action
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.pathId,
    input.stepNo,
    input.title,
    input.instruction ?? null,
    input.criteria ?? null,
    input.stepType,
    input.estimatedTime ?? null,
    input.evidenceConfig ? JSON.stringify(input.evidenceConfig) : null,
    input.isCritical ? 1 : 0,
    input.failureAction ?? null
  );
  return getTroubleshootingStepById(Number(result.lastInsertRowid)) as Promise<DbTroubleshootingStep>;
}

export async function getTroubleshootingStepById(id: number): Promise<DbTroubleshootingStep | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_troubleshooting_steps WHERE id = ?').get(id) as DbTroubleshootingStep | undefined;
}

export async function listTroubleshootingSteps(pathId: number): Promise<DbTroubleshootingStep[]> {
  const db = await getDb();
  return db.prepare('SELECT * FROM ticket_troubleshooting_steps WHERE path_id = ? ORDER BY step_no ASC').all(pathId) as DbTroubleshootingStep[];
}

export async function listTroubleshootingStepsByPathIds(pathIds: number[]): Promise<DbTroubleshootingStep[]> {
  const db = await getDb();
  if (pathIds.length === 0) return [];
  const sql = `SELECT * FROM ticket_troubleshooting_steps WHERE path_id IN (${pathIds.map(() => '?').join(', ')}) ORDER BY step_no ASC`;
  return db.prepare(sql).all(...pathIds) as DbTroubleshootingStep[];
}
