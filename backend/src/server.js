import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { validatePublicHttpUrl } from './security.js';
import { enqueueScan, cancelScan } from './crawler.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
app.disable('x-powered-by');
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true); return cb(new Error('Origin not allowed by CORS')); }, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '16kb' }));
app.use((req,res,next) => { res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); next(); });

app.get('/health', (_req,res) => res.json({ ok: true, service: 'websleuth-api' }));
app.post('/api/scans', async (req,res) => {
  try {
    const raw = req.body?.url;
    if (typeof raw !== 'string' || !raw.trim()) return res.status(400).json({ detail: 'A website URL is required.' });
    const url = await validatePublicHttpUrl(raw.trim());
    const maxDepth = Number(req.body.max_depth ?? 2);
    const maxPages = Number(req.body.max_pages ?? 25);
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 5) return res.status(400).json({ detail: 'max_depth must be an integer from 0 to 5.' });
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 250) return res.status(400).json({ detail: 'max_pages must be an integer from 1 to 250.' });
    const id = randomUUID(); const now = new Date().toISOString();
    db.prepare('INSERT INTO scans(id,target,status,max_depth,max_pages,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, url.href, 'queued', maxDepth, maxPages, now, now);
    enqueueScan(id);
    return res.status(202).json({ id, status: 'queued', target: url.href });
  } catch (e) { return res.status(400).json({ detail: e.message || 'Invalid scan request.' }); }
});
app.get('/api/scans/:id/progress', (req,res) => {
  const scan = db.prepare('SELECT id,target,status,pages_crawled,findings_detected,max_pages,max_depth,created_at,updated_at,error FROM scans WHERE id=?').get(req.params.id);
  if (!scan) return res.status(404).json({ detail: 'Scan not found.' });
  return res.json({ status: scan.status, pages_crawled: scan.pages_crawled, findings_detected: scan.findings_detected, max_pages: scan.max_pages, max_depth: scan.max_depth, error: scan.error, updated_at: scan.updated_at });
});
app.get('/api/scans/:id/pages', (req,res) => {
  if (!db.prepare('SELECT id FROM scans WHERE id=?').get(req.params.id)) return res.status(404).json({ detail: 'Scan not found.' });
  const pages = db.prepare('SELECT url,parent,status FROM pages WHERE scan_id=? ORDER BY rowid').all(req.params.id);
  return res.json({ pages });
});
app.get('/api/scans/:id/findings', (req,res) => {
  if (!db.prepare('SELECT id FROM scans WHERE id=?').get(req.params.id)) return res.status(404).json({ detail: 'Scan not found.' });
  const findings = db.prepare('SELECT category,severity,url,error FROM findings WHERE scan_id=? ORDER BY id').all(req.params.id);
  return res.json({ findings });
});
app.post('/api/scans/:id/cancel', (req,res) => {
  const scan = db.prepare('SELECT id,status FROM scans WHERE id=?').get(req.params.id);
  if (!scan) return res.status(404).json({ detail: 'Scan not found.' });
  if (['completed','completed_with_findings','cancelled','failed','timed_out'].includes(scan.status)) return res.json({ id: scan.id, status: scan.status });
  cancelScan(scan.id);
  db.prepare("UPDATE scans SET status='cancelled',updated_at=? WHERE id=? AND status='queued'").run(new Date().toISOString(), scan.id);
  return res.json({ id: scan.id, status: 'cancelled' });
});
app.use((err, _req, res, _next) => { if (err?.message === 'Origin not allowed by CORS') return res.status(403).json({ detail: 'Origin not allowed.' }); console.error(err); return res.status(500).json({ detail: 'Internal server error.' }); });
app.listen(port, host, () => console.log(`WebSleuth API listening at http://${host}:${port}`));
