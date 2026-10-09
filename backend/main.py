
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from urllib.parse import urlparse
from database import engine, Base, get_db
from sqlalchemy.orm import Session
from models import Scan, Page, Finding
from crawler import crawl

Base.metadata.create_all(bind=engine)

app = FastAPI(title="WebSleuth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://nithinreddy0007.github.io",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScanRequest(BaseModel):
    url: str
    max_depth: int = Field(1, ge=0, le=4)
    max_pages: int = Field(10, ge=1, le=100)


def get_scan_or_404(db: Session, scan_id: str) -> Scan:
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


@app.on_event("startup")
def mark_stale_scans():
    # Scans left "running" by a restart will never finish; don't leave them spinning.
    db = next(get_db())
    try:
        for s in db.query(Scan).filter(Scan.status.in_(["queued", "running"])).all():
            s.status = "failed"
        db.commit()
    finally:
        db.close()


@app.get("/")
def home():
    return {"message": "WebSleuth API is running"}

@app.post("/api/scans")
def create_scan(req: ScanRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    parsed = urlparse(req.url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=422, detail="URL must start with http:// or https://")
    scan = Scan(url=req.url, max_depth=req.max_depth, max_pages=req.max_pages)
    db.add(scan)
    db.commit()
    db.refresh(scan)
    
    background_tasks.add_task(crawl, scan.id)
    return {"status": "queued", "target": req.url, "id": scan.id}

@app.get("/api/scans/{scan_id}")
def get_scan(scan_id: str, db: Session = Depends(get_db)):
    scan = get_scan_or_404(db, scan_id)
    return {"id": scan.id, "status": scan.status, "target": scan.url}

@app.get("/api/scans/{scan_id}/progress")
def get_scan_progress(scan_id: str, db: Session = Depends(get_db)):
    scan = get_scan_or_404(db, scan_id)
    pages_crawled = db.query(Page).filter(Page.scan_id == scan_id).count()
    findings_count = db.query(Finding).filter(Finding.scan_id == scan_id).count()
    return {
        "status": scan.status,
        "pages_crawled": pages_crawled,
        "findings_detected": findings_count,
        "max_pages": scan.max_pages
    }

@app.get("/api/scans/{scan_id}/pages")
def get_scan_pages(scan_id: str, db: Session = Depends(get_db)):
    pages = db.query(Page).filter(Page.scan_id == scan_id).all()
    return {"pages": [{"url": p.url, "status": p.status_code, "parent": p.parent_url} for p in pages]}

@app.get("/api/scans/{scan_id}/findings")
def get_scan_findings(scan_id: str, db: Session = Depends(get_db)):
    findings = db.query(Finding).filter(Finding.scan_id == scan_id).all()
    return {"findings": [{"category": f.category, "severity": f.severity, "url": f.affected_page_url, "error": f.status_or_error} for f in findings]}

@app.post("/api/scans/{scan_id}/cancel")
def cancel_scan(scan_id: str, db: Session = Depends(get_db)):
    scan = get_scan_or_404(db, scan_id)
    if scan.status in ["queued", "running"]:
        scan.status = "cancelled"
        db.commit()
    return {"status": "cancelled"}

@app.get("/health")
def health():
    return {"status": "ok"}
