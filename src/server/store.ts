import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, detail TEXT NOT NULL);`);
  }
  get<T>(id: string): { value: T; revision: number } | undefined {
    const row = this.db.prepare('SELECT payload, revision FROM entries WHERE id=?').get(id);
    return row ? { value: JSON.parse(String(row.payload)) as T, revision: Number(row.revision) } : undefined;
  }
  require<T>(id: string) { const row = this.get<T>(id); if (!row) throw new Error('Record not found'); return row; }
  list<T>(kind: string): T[] { return this.db.prepare('SELECT payload FROM entries WHERE kind=? ORDER BY id').all(kind).map(row => JSON.parse(String(row.payload)) as T); }
  insert(id: string, kind: string, value: unknown) { this.db.prepare('INSERT INTO entries (id, kind, payload) VALUES (?, ?, ?)').run(id, kind, JSON.stringify(value)); }
  put(id: string, kind: string, value: unknown) { this.db.prepare('INSERT INTO entries (id,kind,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, revision=revision+1').run(id, kind, JSON.stringify(value)); }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  audit(action: string, entity: string, detail: unknown) { this.db.prepare('INSERT INTO audit (at,action,entity,detail) VALUES (?,?,?,?)').run(new Date().toISOString(), action, entity, JSON.stringify(detail)); }
  history() { return this.db.prepare('SELECT at,action,entity,detail FROM audit ORDER BY sequence DESC LIMIT 30').all().map(row => ({ ...row, detail: JSON.parse(String(row.detail)) })); }
  close() { this.db.close(); }
}
