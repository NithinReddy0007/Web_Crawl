import asyncio
import ipaddress
import os
import socket
from urllib.parse import urldefrag, urlparse

from playwright.async_api import async_playwright

from database import SessionLocal
from models import Finding, Page, Scan

# Set ALLOW_PRIVATE_HOSTS=1 only for local testing against localhost sites.
ALLOW_PRIVATE = os.getenv("ALLOW_PRIVATE_HOSTS") == "1"

SKIP_EXTENSIONS = (
    ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
    ".mp4", ".mp3", ".css", ".js", ".json", ".xml", ".woff", ".woff2", ".exe",
)


def _is_safe_url_sync(url: str) -> bool:
    """Block non-http(s) URLs and hosts that resolve to private/internal addresses (SSRF guard)."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        if ALLOW_PRIVATE:
            return True
        for info in socket.getaddrinfo(parsed.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if not ip.is_global:
                return False
        return True
    except Exception:
        return False


async def is_safe_url(url: str) -> bool:
    # DNS lookups block, so keep them off the event loop.
    return await asyncio.to_thread(_is_safe_url_sync, url)


def normalize(url: str) -> str:
    return urldefrag(url)[0]


def add_finding(scan_id, category, severity, page_url, failed_url=None, detail=None):
    db = SessionLocal()
    try:
        db.add(Finding(
            scan_id=scan_id,
            category=category,
            severity=severity,
            affected_page_url=page_url,
            failed_request_url=failed_url,
            status_or_error=str(detail) if detail is not None else None,
        ))
        db.commit()
    finally:
        db.close()


def is_cancelled(scan_id) -> bool:
    db = SessionLocal()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        return scan is None or scan.status == "cancelled"
    finally:
        db.close()


async def _async_crawl(scan_id: str):
    db = SessionLocal()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if not scan or scan.status == "cancelled":
            return
        scan.status = "running"
        db.commit()
        start_url = normalize(scan.url)
        max_depth, max_pages = scan.max_depth, scan.max_pages
    finally:
        db.close()

    root_host = urlparse(start_url).hostname
    visited = set()
    queued = {start_url}
    queue = [(start_url, 0, None)]  # url, depth, parent_url
    crawled = 0
    fatal = None

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            context = await browser.new_context()
            page = await context.new_page()
            current = {"url": start_url}

            # Handlers only record findings; they use short-lived DB sessions.
            def on_request_failed(req):
                add_finding(scan_id, "resource failure", "Medium", current["url"], req.url, req.failure)

            def on_response(resp):
                if resp.status >= 400 and resp.url != current["url"]:
                    kind = resp.request.resource_type
                    cat = "API failure" if kind in ("fetch", "xhr") else "resource failure"
                    add_finding(scan_id, cat, "High" if resp.status >= 500 else "Medium",
                                current["url"], resp.url, f"HTTP {resp.status}")

            def on_page_error(err):
                add_finding(scan_id, "JavaScript error", "Low", current["url"], None, err)

            page.on("requestfailed", on_request_failed)
            page.on("response", on_response)
            page.on("pageerror", on_page_error)

            while queue and crawled < max_pages:
                if is_cancelled(scan_id):
                    break
                current_url, depth, parent_url = queue.pop(0)
                if current_url in visited:
                    continue
                visited.add(current_url)

                if not await is_safe_url(current_url):
                    add_finding(scan_id, "blocked URL", "Low", parent_url or current_url,
                                current_url, "Skipped: not a public http(s) address")
                    continue

                current["url"] = current_url
                crawled += 1
                try:
                    response = await page.goto(current_url, timeout=15000, wait_until="domcontentloaded")
                    status = response.status if response else None

                    # A redirect must not land on an internal address.
                    if not await is_safe_url(page.url):
                        raise RuntimeError("Redirected to a non-public address")

                    title = await page.title()
                    db = SessionLocal()
                    try:
                        db.add(Page(scan_id=scan_id, url=current_url, title=title,
                                    status_code=status, parent_url=parent_url, depth=depth))
                        db.commit()
                    finally:
                        db.close()

                    if status is not None and status >= 400:
                        category = "page error" if parent_url is None else "broken link"
                        add_finding(scan_id, category, "High" if status >= 500 else "Medium",
                                    parent_url or current_url, current_url, f"HTTP {status}")
                        continue  # don't crawl error pages

                    if depth < max_depth:
                        hrefs = await page.eval_on_selector_all(
                            "a[href]", "els => els.map(e => e.href)")
                        for href in hrefs:
                            link = normalize(href)
                            parsed = urlparse(link)
                            if (parsed.scheme in ("http", "https")
                                    and parsed.hostname == root_host
                                    and not parsed.path.lower().endswith(SKIP_EXTENSIONS)
                                    and link not in queued):
                                queued.add(link)
                                queue.append((link, depth + 1, current_url))
                except Exception as e:
                    add_finding(scan_id, "page error", "High", current_url, current_url, e)
                    db = SessionLocal()
                    try:
                        db.add(Page(scan_id=scan_id, url=current_url, title=None,
                                    status_code=None, parent_url=parent_url, depth=depth))
                        db.commit()
                    finally:
                        db.close()

            await browser.close()
    except Exception as e:
        fatal = e
        add_finding(scan_id, "scan error", "Critical", start_url, None, e)

    db = SessionLocal()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if scan and scan.status != "cancelled":
            if fatal:
                scan.status = "failed"
            else:
                has_findings = db.query(Finding).filter(Finding.scan_id == scan_id).count() > 0
                scan.status = "completed_with_errors" if has_findings else "completed"
            db.commit()
    finally:
        db.close()


def crawl(scan_id: str):
    """Entry point for FastAPI BackgroundTasks (runs in a worker thread with its own event loop,
    which also avoids Playwright/asyncio subprocess problems on Windows)."""
    asyncio.run(_async_crawl(scan_id))
