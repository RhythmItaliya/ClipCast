#!/usr/bin/env python3
"""
ClipCast page smoke test — the app-side complement to `e2e_full_pipeline.py`.

`e2e_full_pipeline.py` drives the **Modal backend** (download → processor →
clips → audio). It does *not* touch the Next.js app, so a page that 500s renders
nothing to it. This script closes that gap: it logs in as the seeded **admin**
in a real browser and visits **every** app route, failing if any one renders the
error boundary / returns a 5xx.

It exists because of exactly that class of bug: `/admin` was throwing a 500
(`DATABASE_URL` had `connection_limit=1`, so the admin overview's `Promise.all`
fan-out of 6+ server-component queries exhausted the single pooled connection and
tripped `pool_timeout`). No test covered page rendering, so nothing caught it.
This one would have.

Real browser via Playwright (already installed on this machine). Prereqs:
  * Dev server up:  cd clipcast-frontend && npm run dev      (http://localhost:3000)
  * DB seeded:      cd clipcast-frontend && npx tsx prisma/seed.ts
    (so admin@clipcast.local / Admin@1234 exists — see testing/README.md)

Usage:
  python3 testing/page_smoke.py                 # headless, localhost:3000
  python3 testing/page_smoke.py --headed        # watch it drive the browser
  python3 testing/page_smoke.py --shots         # screenshot every page (not just /admin)
  python3 testing/page_smoke.py --base-url http://localhost:3000
  BASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 testing/page_smoke.py

No deps beyond Playwright + stdlib; it parses the repo-root `.env` itself so the
same ADMIN_EMAIL / ADMIN_PASSWORD overrides the seed honours are respected.

Exit code is 0 only if every route passed, else 1.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env"
REPORTS_DIR = Path(__file__).resolve().parent / "reports"

# Error-boundary tell: src/app/error.tsx renders this heading when a segment
# throws (a "soft" 500 that streams a 200 document in dev). We check for it in
# addition to the HTTP status so both hard and soft failures are caught.
ERROR_HEADING = "Something went wrong"


# ── Minimal .env loader (no deps — mirrors e2e_full_pipeline.py) ──────────────
def load_env(path: Path) -> None:
    """Populate os.environ from a KEY="value" .env, without overriding real env."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


# ── Route inventory ───────────────────────────────────────────────────────────
# Logged in as ADMIN. `/`, `/login`, `/signup` server-redirect (admin → /admin,
# auth pages → /dashboard); Playwright's goto follows redirects and returns the
# final 200, so we assert on the resolved page, not the redirect hop.
STATIC_ROUTES = [
    "/",
    "/login",
    "/signup",
    "/dashboard",
    "/dashboard/queue",
    "/dashboard/clips",
    "/dashboard/audio",
    "/dashboard/youtube",
    "/dashboard/billing",
    "/dashboard/settings",
    "/admin",
    "/admin/jobs",
    "/admin/users",
    "/admin/clips",
    "/admin/billing",
    "/admin/audit",
    "/admin/providers",
    "/admin/health",
]

# Dynamic [id] routes: (label, list_page, link_selector) — we open the list,
# grab the first row's link and follow it. Skipped (not failed) when empty,
# since a fresh DB may have no rows.
DYNAMIC_ROUTES = [
    ("admin/jobs/[id]", "/admin/jobs", 'a[href^="/admin/jobs/"]'),
    ("admin/users/[id]", "/admin/users", 'a[href^="/admin/users/"]'),
    ("dashboard/production/[id]", "/dashboard/queue", 'a[href^="/dashboard/production/"]'),
]


def check_page(page, url: str, nav_timeout: int) -> dict:
    """Visit one URL; return a result dict. Collects console/page errors that
    occur during the navigation as warnings (deterministic PASS/FAIL keys off
    HTTP status + error boundary only, to avoid flaky dev-only console noise)."""
    console_errors: list[str] = []
    page_errors: list[str] = []

    def on_console(msg):
        if msg.type == "error":
            console_errors.append(msg.text[:300])

    def on_pageerror(exc):
        page_errors.append(str(exc)[:300])

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=nav_timeout)
        status = resp.status if resp else None
        # Give a soft error boundary a beat to hydrate/render, then probe it
        # without blocking (count() is immediate; no per-page timeout burn).
        page.wait_for_timeout(700)
        boundary = page.locator("h1", has_text=ERROR_HEADING).count() > 0
        title = (page.title() or "").strip()
        final_url = page.url
    finally:
        page.remove_listener("console", on_console)
        page.remove_listener("pageerror", on_pageerror)

    failed = (status is not None and status >= 500) or boundary
    return {
        "status": status,
        "error_boundary": boundary,
        "final_url": final_url.replace(url.split("/")[0], ""),
        "title": title,
        "console_errors": console_errors,
        "page_errors": page_errors,
        "ok": not failed,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="ClipCast admin page smoke test")
    ap.add_argument("--base-url", default=None, help="default http://localhost:3000 or $BASE_URL")
    ap.add_argument("--headed", action="store_true", help="run with a visible browser")
    ap.add_argument("--shots", action="store_true", help="screenshot every page, not just /admin")
    ap.add_argument("--timeout", type=int, default=60, help="per-page nav timeout (s); dev first-compile is slow")
    args = ap.parse_args()

    load_env(ENV_FILE)

    base = (args.base_url or os.environ.get("BASE_URL") or "http://localhost:3000").rstrip("/")
    email = os.environ.get("ADMIN_EMAIL", "admin@clipcast.local")
    password = os.environ.get("ADMIN_PASSWORD", "Admin@1234")
    nav_timeout = args.timeout * 1000

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: Playwright not importable. Try: /usr/bin/python3 testing/page_smoke.py", file=sys.stderr)
        return 1

    ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = REPORTS_DIR / f"smoke-{ts}"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"→ ClipCast page smoke test  ({base})")
    print(f"  admin: {email}\n  report: {out_dir}\n")

    results: list[dict] = []
    login_ok = False

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        # ── Log in as admin via the real credentials form ────────────────────
        try:
            page.goto(f"{base}/login", wait_until="domcontentloaded", timeout=nav_timeout)
            page.fill('input[name="email"]', email)
            page.fill('input[name="password"]', password)
            page.click('button[type="submit"]')
            # Admin lands on /admin (resolveHomePath); accept /dashboard too.
            try:
                page.wait_for_url("**/admin", timeout=nav_timeout)
            except Exception:
                page.wait_for_url("**/dashboard**", timeout=15000)
            login_ok = "/login" not in page.url
        except Exception as exc:  # noqa: BLE001
            print(f"✗ LOGIN FAILED: {exc}")
            print("  Is the dev server up and the DB seeded (npx tsx prisma/seed.ts)?")

        if not login_ok:
            print("✗ Could not authenticate as admin — aborting. (seed the DB, start the dev server)")
            browser.close()
            _write_report(out_dir, base, email, False, results)
            return 1

        print(f"✓ logged in as admin → {page.url}\n")

        # ── Static routes ────────────────────────────────────────────────────
        for path in STATIC_ROUTES:
            r = check_page(page, f"{base}{path}", nav_timeout)
            r["route"] = path
            results.append(r)
            _print_row(path, r)
            if args.shots or path == "/admin":
                shot = out_dir / f"{_slug(path)}.png"
                try:
                    page.screenshot(path=str(shot), full_page=True)
                    r["screenshot"] = str(shot)
                except Exception:  # noqa: BLE001
                    pass

        # ── Dynamic [id] routes (best-effort; skip when no rows) ─────────────
        for label, list_page, selector in DYNAMIC_ROUTES:
            try:
                page.goto(f"{base}{list_page}", wait_until="domcontentloaded", timeout=nav_timeout)
                page.wait_for_timeout(700)
                link = page.locator(selector).first
                if link.count() == 0:
                    print(f"  ○ {label:<32} SKIP (no rows on {list_page})")
                    results.append({"route": label, "ok": True, "skipped": True, "status": None})
                    continue
                href = link.get_attribute("href")
                r = check_page(page, f"{base}{href}", nav_timeout)
                r["route"] = f"{label}  ({href})"
                results.append(r)
                _print_row(r["route"], r)
            except Exception as exc:  # noqa: BLE001
                print(f"  ○ {label:<32} SKIP ({exc})")
                results.append({"route": label, "ok": True, "skipped": True, "status": None})

        browser.close()

    passed = _write_report(out_dir, base, email, login_ok, results)

    tested = [r for r in results if not r.get("skipped")]
    failures = [r for r in tested if not r["ok"]]
    print("\n" + "─" * 60)
    print(f"  {len(tested)} routes tested · {len(tested) - len(failures)} passed · "
          f"{len(failures)} failed · {len(results) - len(tested)} skipped")
    print(f"  report: {out_dir / 'report.json'}")
    if failures:
        print("  FAILED routes:")
        for r in failures:
            print(f"    ✗ {r['route']}  (HTTP {r['status']}, boundary={r.get('error_boundary')})")
    print("─" * 60)
    return 0 if not failures else 1


def _slug(path: str) -> str:
    return (path.strip("/").replace("/", "_") or "root")


def _print_row(label: str, r: dict) -> None:
    mark = "✓" if r["ok"] else "✗"
    warn = ""
    if r.get("error_boundary"):
        warn = "  ⚠ error-boundary"
    elif r.get("page_errors"):
        warn = f"  ⚠ {len(r['page_errors'])} page-error(s)"
    print(f"  {mark} {label:<32} HTTP {str(r['status']):<4}{warn}")


def _write_report(out_dir: Path, base: str, email: str, login_ok: bool, results: list) -> bool:
    tested = [r for r in results if not r.get("skipped")]
    failures = [r for r in tested if not r["ok"]]
    passed = login_ok and not failures
    report = {
        "kind": "page-smoke",
        "generated": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "base_url": base,
        "admin": email,
        "login_ok": login_ok,
        "summary": {
            "tested": len(tested),
            "passed": len(tested) - len(failures),
            "failed": len(failures),
            "skipped": len(results) - len(tested),
            "overall": "PASS" if passed else "FAIL",
        },
        "routes": results,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2))
    return passed


if __name__ == "__main__":
    sys.exit(main())
