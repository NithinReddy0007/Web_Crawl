
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="WebSleuth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://nithinreddy0007.github.io",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

class ScanRequest(BaseModel):
    url: str
    max_depth: int = 1
    max_pages: int = 10

@app.get("/")
def home():
    return {"message": "WebSleuth API is running"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/scans")
def create_scan(req: ScanRequest):
    return {"status": "accepted", "target": req.url}

@app.get("/api/scans/{scan_id}")
def get_scan(scan_id: str):
    return {"id": scan_id, "status": "running"}