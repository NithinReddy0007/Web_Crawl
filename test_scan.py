import requests
import time
import sys

URL = "https://nithinreddy0007.github.io/Web_Crawl/"
API_BASE = "http://localhost:8000"

print(f"Submitting scan for {URL}...")
try:
    res = requests.post(f"{API_BASE}/api/scans", json={
        "url": URL,
        "max_depth": 2,
        "max_pages": 10
    })
    res.raise_for_status()
    data = res.json()
    scan_id = data["id"]
    print(f"Scan accepted! ID: {scan_id}")
    
    while True:
        prog_res = requests.get(f"{API_BASE}/api/scans/{scan_id}/progress")
        prog_res.raise_for_status()
        prog = prog_res.json()
        print(f"Status: {prog['status']}, Crawled: {prog['pages_crawled']}, Findings: {prog['findings_detected']}")
        
        if prog["status"] not in ["queued", "running"]:
            break
        time.sleep(2)
        
    pages_res = requests.get(f"{API_BASE}/api/scans/{scan_id}/pages")
    findings_res = requests.get(f"{API_BASE}/api/scans/{scan_id}/findings")
    
    print("\n--- Discovered Pages ---")
    for p in pages_res.json().get("pages", []):
        print(f"{p['url']} (Status: {p['status']})")
        
    print("\n--- Findings ---")
    for f in findings_res.json().get("findings", []):
        print(f"[{f['severity']}] {f['category']} on {f['url']}: {f['error']}")
        
except Exception as e:
    print(f"Error: {e}")
