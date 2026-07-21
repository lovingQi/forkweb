import type Database from 'better-sqlite3';
import { getDb } from './index';

export type UserRole = 'after_sales' | 'rd' | 'admin';

export interface DbUser {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  display_name: string | null;
  email: string | null;
  disabled: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  role: UserRole;
  displayName?: string;
  email?: string;
}

export async function createUser(input: CreateUserInput): Promise<DbUser> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO users (username, password_hash, role, display_name, email)
     VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.username,
    input.passwordHash,
    input.role,
    input.displayName || null,
    input.email || null
  );
  return getUserById(Number(result.lastInsertRowid)) as Promise<DbUser>;
}

export async function getUserById(id: number): Promise<DbUser | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
}

export async function getUserByUsername(username: string): Promise<DbUser | undefined> {
  const db = await getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as DbUser | undefined;
}

export async function listUsers(): Promise<DbUser[]> {
  const db = await getDb();
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as DbUser[];
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row.count;
}

export async function updateUser(
  id: number,
  input: Partial<Pick<CreateUserInput, 'displayName' | 'email' | 'role'>> & { passwordHash?: string; disabled?: boolean }
): Promise<DbUser | undefined> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.displayName !== undefined) {
    sets.push('display_name = ?');
    values.push(input.displayName || null);
  }
  if (input.email !== undefined) {
    sets.push('email = ?');
    values.push(input.email || null);
  }
  if (input.role !== undefined) {
    sets.push('role = ?');
    values.push(input.role);
  }
  if (input.passwordHash !== undefined) {
    sets.push('password_hash = ?');
    values.push(input.passwordHash);
  }
  if (input.disabled !== undefined) {
    sets.push('disabled = ?');
    values.push(input.disabled ? 1 : 0);
  }
  if (sets.length === 0) return getUserById(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(id);
}

export async function disableUser(id: number, disabled: boolean): Promise<DbUser | undefined> {
  return updateUser(id, { disabled });
}

export async function updateUserLastLogin(id: number): Promise<DbUser | undefined> {
  const db = await getDb();
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
  return getUserById(id);
}

export async function deleteUser(id: number): Promise<boolean> {
  const db = await getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}
