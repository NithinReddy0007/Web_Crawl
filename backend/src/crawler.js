import { setTimeout as delay } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { db, addFinding } from './db.js';
import { validatePublicHttpUrl } from './security.js';

const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const maxBytes = Number(process.env.MAX_RESPONSE_BYTES || 3000000);
const userAgent = process.env.USER_AGENT || 'WebSleuthBot/1.0';
const active = new Map();
const pending = [];
let runningCount = 0;
const maxConcurrent = Math.max(1, Math.min(4, Number(process.env.MAX_CONCURRENT_SCANS || 2)));
function pumpQueue() { while (runningCount < maxConcurrent && pending.length) { const id = pending.shift(); runningCount++; void crawl(id).finally(() => { runningCount--; pumpQueue(); }); } }
const updateScan = db.prepare('UPDATE scans SET status=?, pages_crawled=?, findings_detected=?, updated_at=?, error=? WHERE id=?');
const insertPage = db.prepare('INSERT OR IGNORE INTO pages(scan_id,url,parent,status,title) VALUES(?,?,?,?,?)');
const updatePage = db.prepare('UPDATE pages SET status=?,title=? WHERE scan_id=? AND url=?');

function normalize(raw, base) {
  try {
    const u = new URL(raw, base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/{2,}/g, '/');
    return u.href;
  } catch { return null; }
}
function isHtml(type='') { return /text\/html|application\/xhtml\+xml/i.test(type); }
function addSecurityFindings(scanId, url, response, $) {
  const headers = response.headers;
  if (new URL(url).protocol === 'https:') {
    for (const [header, category, severity] of [
      ['strict-transport-security','Missing HSTS','low'], ['content-security-policy','Missing Content Security Policy','low'],
      ['x-content-type-options','Missing X-Content-Type-Options','low'], ['referrer-policy','Missing Referrer-Policy','info']
    ]) if (!headers.get(header)) addFinding(scanId, category, severity, url, `Response does not include ${header}.`);
  }
  if (!response.ok) addFinding(scanId, response.status === 404 ? 'Broken page' : 'HTTP error', response.status >= 500 ? 'high' : 'medium', url, `Page returned HTTP ${response.status}.`);
  const title = $('title').first().text().trim();
  const description = $('meta[name="description" i]').attr('content')?.trim() || '';
  const h1s = $('h1').length;
  if (!title) addFinding(scanId, 'Missing title', 'medium', url, 'Page has no non-empty <title>.');
  else if (title.length > 60) addFinding(scanId, 'Long title', 'info', url, `Title is ${title.length} characters; consider keeping it concise.`);
  if (!description) addFinding(scanId, 'Missing meta description', 'low', url, 'Page has no meta description.');
  else if (description.length > 160) addFinding(scanId, 'Long meta description', 'info', url, `Description is ${description.length} characters.`);
  if (h1s === 0) addFinding(scanId, 'Missing H1', 'low', url, 'Page has no H1 heading.');
  if (h1s > 1) addFinding(scanId, 'Multiple H1 headings', 'info', url, `Page has ${h1s} H1 headings.`);
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical && normalize(canonical, url) === null) addFinding(scanId, 'Invalid canonical URL', 'low', url, 'Canonical link is not a valid HTTP(S) URL.');
  const imgs = $('img');
  const missingAlt = imgs.filter((_, el) => !$(el).attr('alt')?.trim()).length;
  if (missingAlt) addFinding(scanId, 'Images missing alt text', 'low', url, `${missingAlt} image(s) have no alt text.`);
  if (new URL(url).protocol === 'https:' && $('a[href^="http://"]').length) addFinding(scanId, 'HTTP links on HTTPS page', 'low', url, 'Page contains links to insecure HTTP URLs.');
}

async function safeFetch(startUrl, signal) {
  let current = startUrl;
  for (let redirects = 0; redirects <= 5; redirects++) {
    await validatePublicHttpUrl(current); // revalidate every redirect destination
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    let response;
    try {
      response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' } });
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    if ([301,302,303,307,308].includes(response.status)) {
      const loc = response.headers.get('location');
      if (!loc) return { response, url: current, body: '' };
      if (redirects === 5) throw new Error('Too many redirects.');
      current = normalize(loc, current);
      if (!current) throw new Error('Redirect points to an invalid URL.');
      continue;
    }
    const type = response.headers.get('content-type') || '';
    if (!isHtml(type)) return { response, url: current, body: '' };
    const reader = response.body?.getReader();
    if (!reader) return { response, url: current, body: '' };
    let total = 0; const chunks = [];
    try {
      while (true) {
        if (signal.aborted) throw signal.reason || new Error('Cancelled');
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new Error('Page response exceeded the configured size limit.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return { response, url: current, body: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('Too many redirects.');
}

async function maybeRender(url, html, signal) {
  if (process.env.ENABLE_BROWSER_RENDERING === 'false' || !html || html.length > 500_000) return null;
  const $ = cheerio.load(html);
  const visibleText = $('body').text().replace(/\s+/g, ' ').trim();
  const hasLinks = $('a[href]').length > 0;
  if (visibleText.length > 100 && hasLinks) return null;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ userAgent });
    page.setDefaultNavigationTimeout(Math.min(timeoutMs, 15000));
    await page.route('**/*', async route => {
      const requestUrl = route.request().url();
      try { await validatePublicHttpUrl(requestUrl); await route.continue(); }
      catch { await route.abort('blockedbyclient'); }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 15000) });
    if (signal.aborted) return null;
    return await page.content();
  } catch { return null; }
  finally { await browser?.close().catch(() => {}); }
}

async function crawl(scanId) {
  const scan = db.prepare('SELECT * FROM scans WHERE id=?').get(scanId);
  if (!scan || scan.status === 'cancelled') return;
  const controller = new AbortController(); active.set(scanId, controller);
  let status = 'completed'; let error = null;
  let pagesCrawled = 0;
  const seen = new Set(); const queue = [{ url: scan.target, parent: null, depth: 0 }];
  const origin = new URL(scan.target).origin;
  const robotsDisallow = [];
  try {
    // Respect a basic robots.txt disallow list when it can be fetched safely.
    try {
      const robotsUrl = new URL('/robots.txt', scan.target).href;
      const r = await safeFetch(robotsUrl, controller.signal);
      if (r.response.ok) for (const line of r.body.split(/\r?\n/)) {
        if (/^\s*Disallow:/i.test(line)) { const p = line.split(':').slice(1).join(':').trim(); if (p) robotsDisallow.push(p); }
      }
    } catch { /* robots.txt is best-effort; crawling still uses strict safety limits */ }
    updateScan.run('running', 0, 0, new Date().toISOString(), null, scanId);
    while (queue.length && pagesCrawled < scan.max_pages) {
      if (controller.signal.aborted) { status = 'cancelled'; break; }
      const item = queue.shift();
      if (!item || seen.has(item.url) || item.depth > scan.max_depth) continue;
      seen.add(item.url);
      if (new URL(item.url).origin !== origin) continue;
      if (robotsDisallow.some(path => new URL(item.url).pathname.startsWith(path))) {
        insertPage.run(scanId, item.url, item.parent, null, null); pagesCrawled++; continue;
      }
      let fetched;
      try { fetched = await safeFetch(item.url, controller.signal); }
      catch (e) {
        if (controller.signal.aborted) { status = 'cancelled'; break; }
        insertPage.run(scanId, item.url, item.parent, null, null);
        addFinding(scanId, 'Fetch failed', 'medium', item.url, e.message || 'Could not fetch page.');
        pagesCrawled++; updateCounts(); continue;
      }
      const finalUrl = fetched.url;
      if (!seen.has(finalUrl)) seen.add(finalUrl);
      let html = fetched.body;
      if (html && (html.length < 300 || !/<a\b/i.test(html))) html = await maybeRender(finalUrl, html, controller.signal) || html;
      const $ = cheerio.load(html || '');
      const title = $('title').first().text().trim() || null;
      insertPage.run(scanId, finalUrl, item.parent, fetched.response.status, title);
      updatePage.run(fetched.response.status, title, scanId, finalUrl);
      if (finalUrl !== item.url) addFinding(scanId, 'Redirect', 'info', item.url, `Redirected to ${finalUrl}.`);
      if (html && isHtml(fetched.response.headers.get('content-type') || 'text/html')) {
        addSecurityFindings(scanId, finalUrl, fetched.response, $);
        if (item.depth < scan.max_depth) {
          $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) return;
            const next = normalize(href, finalUrl);
            if (!next || seen.has(next) || new URL(next).origin !== origin) return;
            if (queue.length + pagesCrawled < scan.max_pages * 3) queue.push({ url: next, parent: finalUrl, depth: item.depth + 1 });
          });
        }
      }
      pagesCrawled++;
      updateCounts();
      await delay(50);
    }
    if (controller.signal.aborted && status !== 'cancelled') status = 'cancelled';
    else if (queue.length && pagesCrawled >= scan.max_pages) status = 'completed_with_findings';
  } catch (e) {
    status = controller.signal.aborted ? 'cancelled' : 'failed'; error = e?.message || 'Unexpected crawler error';
  } finally {
    active.delete(scanId);
    const counts = getCounts(scanId);
    updateScan.run(status, counts.pages, counts.findings, new Date().toISOString(), error, scanId);
  }
  function getCounts(id) {
    return { pages: db.prepare('SELECT COUNT(*) AS n FROM pages WHERE scan_id=?').get(id).n, findings: db.prepare('SELECT COUNT(*) AS n FROM findings WHERE scan_id=?').get(id).n };
  }
  function updateCounts() {
    const c = getCounts(scanId);
    updateScan.run('running', c.pages, c.findings, new Date().toISOString(), null, scanId);
  }
}

export function enqueueScan(id) { pending.push(id); pumpQueue(); }
export function cancelScan(id) { const controller = active.get(id); if (controller) controller.abort(new Error('Cancelled by user')); }
