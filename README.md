# WebSleuth — frontend + backend

This folder contains the existing React/TanStack frontend and a Node.js API crawler backend. The frontend is configured to call the local backend by default.

## Requirements

- Node.js 20 or newer (prefer the current LTS release)
- npm
- Internet access for installing dependencies and crawling public websites
- Optional: Chromium for JavaScript-rendered fallback crawling

## First-time setup

### 1. Start the backend

Open a terminal in this folder, then run:

```bash
cd backend
npm install
npm run dev
```

The backend uses the included `backend/.env` local defaults. It listens on `http://127.0.0.1:8787`. Verify it by opening `http://127.0.0.1:8787/health` in your browser.

### 2. Start the frontend in a second terminal

From the project root (the folder containing this README and the root `package.json`):

```bash
npm install
npm run dev
```

Open the local URL Vite prints in the terminal (usually `http://localhost:5173`). The included `.env.local` already points the frontend to `http://127.0.0.1:8787`.

Keep both terminals running while using the app.

### 3. Optional: enable browser rendering

Regular HTML crawling works without Chromium. To enable the Playwright fallback for JavaScript-heavy pages, open a terminal in the project root and run:

```bash
cd backend
npm run install:browser
```

If the browser install fails, try regular HTML crawling first; browser rendering is optional.

## What you need to fill in

**For local development: nothing.** The local `.env.local` and `backend/.env` files are already populated with safe local defaults.

Only change these values if your setup differs:

- `VITE_API_URL` in `.env.local`: backend URL. Leave it as `http://127.0.0.1:8787` for local use.
- `FRONTEND_ORIGIN` in `backend/.env`: exact origin shown in your browser, normally `http://localhost:5173`. If Vite uses a different port, update this to match.
- `PORT` in `backend/.env`: backend port; keep `8787` unless it is already in use.
- `DATABASE_PATH`: SQLite database location. The default creates `backend/data/websleuth.sqlite` automatically.

No API key or password is required for the current local version. Do not add secrets to the frontend `.env.local`; variables beginning with `VITE_` are exposed to the browser.

## Tests

Backend security tests:

```bash
cd backend
npm test
```

Frontend tests (from the project root, in another terminal):

```bash
npm test
```

## API endpoints used by the frontend

- `GET /health`
- `POST /api/scans`
- `GET /api/scans/:id/progress`
- `GET /api/scans/:id/pages`
- `GET /api/scans/:id/findings`
- `POST /api/scans/:id/cancel`

## Important limitations and safety

- Only crawl websites you own or have permission to assess.
- The crawler is limited to the starting origin and bounded by page/depth limits.
- This is a basic site mapper, technical SEO checker, and non-invasive header audit—not a full penetration test or a guarantee of security.
- Before deploying publicly, add authentication, rate limiting/abuse controls, and stronger network-level SSRF/DNS-rebinding protection. Do not expose this development backend directly to the public internet.
- SQLite is suited to a single backend instance. A cloud deployment needs persistent storage or a database migration, plus correct CORS configuration.
- The included `.env` files are for local development. If you deploy the app, set environment variables in your hosting provider instead of copying local addresses into production.
