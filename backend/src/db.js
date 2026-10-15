import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const dbPath = process.env.DATABASE_PATH || './data/websleuth.sqlite';
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, target TEXT NOT NULL, status TEXT NOT NULL, max_depth INTEGER NOT NULL, max_pages INTEGER NOT NULL, pages_crawled INTEGER NOT NULL DEFAULT 0, findings_detected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS pages (scan_id TEXT NOT NULL, url TEXT NOT NULL, parent TEXT, status INTEGER, title TEXT, PRIMARY KEY(scan_id,url), FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS findings (id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL, url TEXT NOT NULL, error TEXT, FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS pages_scan_idx ON pages(scan_id);
CREATE INDEX IF NOT EXISTS findings_scan_idx ON findings(scan_id);
`);
export function addFinding(scanId, category, severity, url, error) {
  const exists = db.prepare('SELECT 1 FROM findings WHERE scan_id=? AND category=? AND url=? AND error IS ?').get(scanId, category, url, error ?? null);
  if (!exists) db.prepare('INSERT INTO findings(scan_id,category,severity,url,error) VALUES(?,?,?,?,?)').run(scanId, category, severity, url, error ?? null);
}
