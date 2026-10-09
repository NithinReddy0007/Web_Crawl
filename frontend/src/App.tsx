
import { useState } from 'react'
import './App.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')

type ScanResult = {
  status?: string
  target?: string
  id?: string
  detail?: string
}

function App() {
  const [url, setUrl] = useState('')
  const [depth, setDepth] = useState(2)
  const [maxPages, setMaxPages] = useState(25)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState('')

  async function startScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error()
    } catch {
      setError('Enter a valid website URL, such as https://example.com')
      return
    }

    if (!API_URL) {
      setError(
        'The API is not connected yet. Deploy the FastAPI backend and configure VITE_API_URL to enable real scans.',
      )
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: parsedUrl.href,
          max_depth: depth,
          max_pages: maxPages,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.detail || `Request failed (${response.status})`)
      }
      setResult(data)
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}. Check that the API is online and allows requests from this website.`
          : 'Unable to contact the API.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="WebSleuth home">
          <span className="brand-icon">⌕</span>
          <span>web<span className="brand-light">sleuth</span></span>
        </a>
        <div className="topbar-right">
          <span className="status-dot" />
          <span>WEB INTELLIGENCE WORKSPACE</span>
        </div>
      </header>

      <section className="hero" id="home">
        <div className="eyebrow"><span /> WEBSITE INTELLIGENCE, SIMPLIFIED</div>
        <h1>Explore the web.<br /><span>Understand the structure.</span></h1>
        <p className="hero-copy">
          Map a website, inspect its pages, and uncover its structure from one workspace.
        </p>

        <form className="scan-card" onSubmit={startScan}>
          <label className="field-label" htmlFor="website-url">TARGET WEBSITE</label>
          <div className="url-input-wrap">
            <span className="url-icon">↗</span>
            <input
              id="website-url"
              type="text"
              placeholder="https://example.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
            <span className="https-label">HTTP / HTTPS</span>
          </div>

          <div className="settings-grid">
            <label className="setting">
              <span className="field-label">CRAWL DEPTH</span>
              <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
                <option value={1}>1 — Direct links</option>
                <option value={2}>2 — Two levels</option>
                <option value={3}>3 — Deep crawl</option>
                <option value={4}>4 — Extended</option>
              </select>
            </label>
            <label className="setting">
              <span className="field-label">PAGE LIMIT</span>
              <select value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))}>
                <option value={10}>10 pages</option>
                <option value={25}>25 pages</option>
                <option value={50}>50 pages</option>
                <option value={100}>100 pages</option>
              </select>
            </label>
          </div>

          <button className="scan-button" type="submit" disabled={loading}>
            {loading ? 'Connecting to API…' : '⌕  Start website scan'} <span>→</span>
          </button>

          {error && <div className="message error-message" role="alert">{error}</div>}
          {result && (
            <div className="message success-message" role="status">
              <strong>API response received</strong>
              <p>Status: {result.status || 'unknown'}</p>
              <p>Target: {result.target || url}</p>
              {result.id && <p>Scan ID: {result.id}</p>}
              <p className="result-note">
                This confirms the API accepted the request; it does not confirm that crawling is complete.
              </p>
            </div>
          )}
        </form>

        <div className="trust-note"><span>✳</span> Only scan websites you own or have permission to test.</div>
      </section>

      <section className="features">
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h2>Everything starts with a URL.</h2>
          </div>
          <span className="preview-tag">PLATFORM PREVIEW</span>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <div className="feature-icon violet">⌘</div>
            <h3>Site discovery</h3>
            <p>Configure crawl depth and page limits to define the scope of a scan.</p>
            <span className="card-number">01 / DISCOVER</span>
          </article>
          <article className="feature-card">
            <div className="feature-icon blue">◎</div>
            <h3>Structure mapping</h3>
            <p>Prepare a foundation for exploring pages and relationships across a website.</p>
            <span className="card-number">02 / MAP</span>
          </article>
          <article className="feature-card">
            <div className="feature-icon green">↗</div>
            <h3>Scan insights</h3>
            <p>Use a connected crawler API to power future scan history and findings.</p>
            <span className="card-number">03 / ANALYZE</span>
          </article>
        </div>
      </section>

      <footer>
        <a className="footer-brand" href="#home">websleuth<span>.</span></a>
        <span>Website intelligence workspace</span>
        <span>Built for the open web · {new Date().getFullYear()}</span>
      </footer>
    </main>
  )
}

export default App