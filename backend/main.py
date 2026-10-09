from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="WebSleuth API")

class ScanRequest(BaseModel):
    url: str
    max_depth: int = 1
    max_pages: int = 10

@app.post("/api/scans")
def create_scan(req: ScanRequest):
    return {"status": "accepted", "target": req.url}

@app.get("/api/scans/{scan_id}")
def get_scan(scan_id: str):
    return {"id": scan_id, "status": "running"}
