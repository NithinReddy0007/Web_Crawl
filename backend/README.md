# WebSleuth API backend

Node.js API that matches the existing frontend contract (`POST /api/scans`, plus `progress`, `pages`, `findings`, and `cancel`). SQLite persists scans/results. Crawling is intentionally limited to the exact origin of the submitted URL.

## Requirements
- Node.js 20+
- npm
- Optional Chromium install for JS-rendered fallback pages

## Run locally
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```
The API listens on `http://127.0.0.1:8787`; check `GET /health`. For browser rendering, run `npm run install:browser` once. If Chromium isn't installed, regular HTML crawling still works; browser fallback errors are ignored.

In the frontend project's root, create/update `.env.local`:
```dotenv
VITE_API_URL=http://127.0.0.1:8787
```
Restart the frontend dev server after changing environment variables. Set `FRONTEND_ORIGIN` in the backend to the frontend's exact origin. For example, use `http://localhost:5173` locally. For production, configure the deployed frontend origin and a persistent disk for `DATABASE_PATH`.

## API contract
- `POST /api/scans` JSON `{ "url": "https://example.com", "max_depth": 2, "max_pages": 25 }` → `202 { id, status, target }`
- `GET /api/scans/:id/progress` → `{ status, pages_crawled, findings_detected, max_pages, max_depth, error, updated_at }`
- `GET /api/scans/:id/pages` → `{ pages: [{ url, parent, status }] }`
- `GET /api/scans/:id/findings` → `{ findings: [{ category, severity, url, error }] }`
- `POST /api/scans/:id/cancel` → `{ id, status }`

Depth is capped at 5 and pages at 250. The crawler uses per-request timeouts and response-size limits, follows at most five redirects, revalidates redirect URLs, blocks non-public IP ranges, stays on the starting origin, and provides basic technical SEO/header observations. This is not a full penetration tester or a guarantee of security. Only scan sites you own or have permission to assess.

## Tests
```bash
npm test
```

## Current limitations to know about
- Browser rendering is a fallback heuristic, not a full browser crawler; some SPAs may still require tuning.
- Robots.txt support is basic and best-effort, not a complete RFC parser.
- Link checks are limited to pages discovered within the starting origin; external links are not fetched.
- SQLite is appropriate for a single backend instance. Use persistent storage in deployment; ephemeral server filesystems can lose the database on redeploy.
- DNS is checked before requests, but robust production-grade DNS pinning / rebinding defense should be added at the network transport layer before exposing this service to untrusted users. Keep it behind authentication/rate limiting before public deployment.
- No authentication/rate limiting is included yet. Do not expose this API publicly without those controls.
