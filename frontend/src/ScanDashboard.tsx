import { useEffect, useState } from 'react'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'

export default function ScanDashboard({ scanId }: { scanId: string }) {
  const [progress, setProgress] = useState<any>(null)
  const [pages, setPages] = useState<any[]>([])
  const [findings, setFindings] = useState<any[]>([])
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    let interval = setInterval(async () => {
      try {
        const progRes = await fetch(`${API_URL}/api/scans/${scanId}/progress`)
        if (progRes.ok) {
          setFetchError('')
          const progData = await progRes.json()
          setProgress(progData)
          if (progData.status !== 'queued' && progData.status !== 'running') {
            clearInterval(interval)
          }
        }
        
        const pagesRes = await fetch(`${API_URL}/api/scans/${scanId}/pages`)
        if (pagesRes.ok) {
          const p = await pagesRes.json()
          setPages(p.pages || [])
        }
        
        const findRes = await fetch(`${API_URL}/api/scans/${scanId}/findings`)
        if (findRes.ok) {
          const f = await findRes.json()
          setFindings(f.findings || [])
        }
      } catch (err) {
        console.error(err)
        setFetchError('Cannot reach the API right now (it may be waking up). Retrying…')
      }
    }, 2000)
    
    return () => clearInterval(interval)
  }, [scanId])

  if (!progress) return <div>{fetchError || 'Loading progress...'}</div>

  return (
    <div className="dashboard" style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2>Scan Progress</h2>
      <p>Status: <strong>{progress.status}</strong></p>
      <p>Pages Crawled: {progress.pages_crawled} / {progress.max_pages}</p>
      <p>Findings Detected: {progress.findings_detected}</p>
      
      <h3>Pages Discovered</h3>
      <ul>
        {pages.map((p, i) => (
          <li key={i}>{p.url} (Status: {p.status}) {p.parent ? ` - found on ${p.parent}` : ''}</li>
        ))}
      </ul>
      
      <h3>Findings</h3>
      <ul>
        {findings.map((f, i) => (
          <li key={i}>[{f.severity}] {f.category} at {f.url} - {f.error}</li>
        ))}
      </ul>
      
      {['queued', 'running'].includes(progress.status) && (
        <button onClick={async () => {
          await fetch(`${API_URL}/api/scans/${scanId}/cancel`, { method: 'POST' })
        }}>Cancel Scan</button>
      )}
    </div>
  )
}
