import asyncio
from playwright.async_api import async_playwright
from database import SessionLocal
from models import Scan, Page, Finding
import socket
import ipaddress
from urllib.parse import urlparse

def is_safe_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ["http", "https"]:
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        
        # Check against private IPs
        ip = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local:
            return False
        return True
    except Exception:
        return False

async def _async_crawl(scan_id: str):
    db = SessionLocal()
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        db.close()
        return

    scan.status = "running"
    db.commit()

    visited = set()
    queue = [(scan.url, 0, None)]  # url, depth, parent_url
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            page = await context.new_page()
            
            # Record network errors
            page.on("requestfailed", lambda req: handle_request_failed(req, scan_id, page.url, db))
            page.on("pageerror", lambda err: handle_page_error(err, scan_id, page.url, db))
            
            while queue and len(visited) < scan.max_pages:
                current_url, depth, parent_url = queue.pop(0)
                
                if current_url in visited or not is_safe_url(current_url):
                    continue
                
                visited.add(current_url)
                
                try:
                    response = await page.goto(current_url, timeout=10000)
                    title = await page.title()
                    status = response.status if response else None
                    
                    db_page = Page(scan_id=scan_id, url=current_url, title=title, status_code=status, parent_url=parent_url, depth=depth)
                    db.add(db_page)
                    db.commit()
                    
                    if depth < scan.max_depth:
                        links = await page.eval_on_selector_all("a[href]", "elements => elements.map(e => e.href)")
                        for link in links:
                            if is_safe_url(link) and urlparse(link).hostname == urlparse(scan.url).hostname:
                                queue.append((link, depth + 1, current_url))
                                
                except Exception as e:
                    finding = Finding(scan_id=scan_id, category="page error", severity="High", affected_page_url=current_url, status_or_error=str(e))
                    db.add(finding)
                    db.commit()
            
            await browser.close()
        
        scan.status = "completed"
    except Exception as e:
        scan.status = "failed"
        finding = Finding(scan_id=scan_id, category="scan error", severity="Critical", affected_page_url=scan.url, status_or_error=str(e))
        db.add(finding)
    finally:
        db.commit()
        db.close()

def handle_request_failed(req, scan_id, page_url, db):
    finding = Finding(
        scan_id=scan_id,
        category="resource failure",
        severity="Medium",
        affected_page_url=page_url,
        failed_request_url=req.url,
        status_or_error=req.failure
    )
    db.add(finding)
    db.commit()

def handle_page_error(err, scan_id, page_url, db):
    finding = Finding(
        scan_id=scan_id,
        category="JavaScript error",
        severity="Low",
        affected_page_url=page_url,
        status_or_error=str(err)
    )
    db.add(finding)
    db.commit()
