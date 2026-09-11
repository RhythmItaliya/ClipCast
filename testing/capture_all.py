#!/usr/bin/env python3
"""
Full-system screenshot capture for the ClipCast documentation.

Walks the ENTIRE app through a real browser (Playwright) and screenshots every
route, subpage, and the interactive "open" states (sidebar is in every shot;
plus tab switches, the login OTP modal, the Library expanded group, and the
admin user/job detail pages). Output lands in a top-level `screenshots/` folder,
organised into sections and indexed by `INDEX.md`, ready to drop into the docs.

Three passes, each with the right auth:
  01-public : logged OUT — landing, signup, login (+ OTP modal open)
  02-app    : as the seeded CLIENT — full dashboard + Audio Studio + Library
              (expanded) + Production Room + queue/youtube/billing/settings
  03-admin  : as the seeded ADMIN — every /admin page + a user + a job detail

Prereqs: dev server up (`npm run dev`), DB seeded (`npx tsx prisma/seed.ts`).
Creds come from .env (ADMIN_/CLIENT_), defaulting to the seed values.

Run (Playwright lives on the system python):
  /usr/bin/python3 testing/capture_all.py                 # -> ./screenshots
  /usr/bin/python3 testing/capture_all.py --out screenshots --headed
"""
from __future__ import annotations

import argparse
import datetime as _dt
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def _ts() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%H:%M:%SZ")


# Collected (section, filename, caption) for the INDEX.md.
_manifest: list[tuple[str, str, str]] = []


def shoot(page, out: Path, section: str, name: str, caption: str) -> None:
    sec_dir = out / section
    sec_dir.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(400)
    path = sec_dir / f"{name}.png"
    page.screenshot(path=str(path), full_page=True)
    _manifest.append((section, name, caption))
    print(f"    · {section}/{name}.png — {caption}")


def goto(page, base: str, route: str, nav_timeout: int, settle: int = 2200) -> None:
    page.goto(f"{base}{route}", wait_until="domcontentloaded", timeout=nav_timeout)
    page.wait_for_timeout(settle)


def login(page, base: str, email: str, pw: str, nav_timeout: int) -> bool:
    page.goto(f"{base}/login", wait_until="domcontentloaded", timeout=nav_timeout)
    page.fill('input[name="email"]', email)
    page.fill('input[name="password"]', pw)
    page.click('button[type="submit"]')
    try:
        page.wait_for_url(lambda u: "/login" not in u, timeout=nav_timeout)
    except Exception:
        pass
    return "/login" not in page.url


def _try(desc: str, fn) -> None:
    """Run an optional interactive step; log-and-continue on failure."""
    try:
        fn()
    except Exception as e:  # noqa: BLE001 — a doc shot failing must not abort the run
        print(f"    ! skipped {desc}: {type(e).__name__}: {str(e)[:80]}")


# ---------------------------------------------------------------- sections ---
def capture_public(browser, base: str, out: Path, nav_timeout: int) -> None:
    print("  [01-public] logged out")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    try:
        goto(page, base, "/", nav_timeout)
        shoot(page, out, "01-public", "01_landing", "Marketing landing page")
        goto(page, base, "/signup", nav_timeout)
        shoot(page, out, "01-public", "02_signup", "Sign-up (email + OAuth)")
        goto(page, base, "/login", nav_timeout)
        shoot(page, out, "01-public", "03_login", "Login (password + OAuth)")

        def _otp():
            page.get_by_role("button", name="Sign in with a code instead").click()
            page.wait_for_selector('[role="dialog"]', timeout=5000)
            page.wait_for_timeout(400)
            shoot(page, out, "01-public", "04_login_otp_modal",
                  "Login — 'sign in with a code' OTP modal (open)")
        _try("OTP modal", _otp)
    finally:
        ctx.close()


def capture_app(browser, base: str, out: Path, email: str, pw: str, nav_timeout: int) -> None:
    print(f"  [02-app] as client ({email})")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    try:
        if not login(page, base, email, pw, nav_timeout):
            print("    ✗ client login failed — dev server up? DB seeded?", file=sys.stderr)
            return

        # Dashboard / Uploader — both tabs + the preview toggle context.
        goto(page, base, "/dashboard", nav_timeout)
        shoot(page, out, "02-app", "01_dashboard_upload_tab",
              "Dashboard — Uploader (Upload File tab) + clip-mode chips")
        _try("YouTube tab", lambda: (
            page.get_by_role("button", name="YouTube URL").click(),
            page.wait_for_timeout(500),
            shoot(page, out, "02-app", "02_dashboard_youtube_tab",
                  "Dashboard — Uploader switched to the YouTube URL tab")))

        # Queue.
        goto(page, base, "/dashboard/queue", nav_timeout)
        shoot(page, out, "02-app", "03_queue", "Processing queue (job status)")

        # Library — closed, then a group expanded, then the Production Room.
        goto(page, base, "/dashboard/clips", nav_timeout)
        shoot(page, out, "02-app", "04_library", "Library — sources collapsed")

        def _expand_and_production():
            page.locator("button:has(h3)").first.click()
            page.wait_for_timeout(1200)
            shoot(page, out, "02-app", "05_library_expanded",
                  "Library — a source expanded to its clip grid")
            page.locator('a[href^="/dashboard/production/"]').first.click()
            page.wait_for_url("**/dashboard/production/**", timeout=nav_timeout)
            page.wait_for_timeout(2000)
            shoot(page, out, "02-app", "06_production_room",
                  "Production Room — the AI crew's decision trail for a source")
        _try("Library expand + Production Room", _expand_and_production)

        # Audio Studio — default (AI Mix) then Compose.
        goto(page, base, "/dashboard/audio", nav_timeout)
        shoot(page, out, "02-app", "07_audio_studio_mix",
              "Audio Studio — AI Mix (YouTube × YouTube mashup) tab")
        _try("Audio Compose tab", lambda: (
            page.get_by_role("button", name="Compose").click(),
            page.wait_for_timeout(500),
            shoot(page, out, "02-app", "08_audio_studio_compose",
                  "Audio Studio — Compose (text-to-music) tab")))

        # Remaining client pages.
        goto(page, base, "/dashboard/youtube", nav_timeout)
        shoot(page, out, "02-app", "09_youtube_connect", "YouTube — connect channel / posting")
        goto(page, base, "/dashboard/billing", nav_timeout)
        shoot(page, out, "02-app", "10_billing", "Billing — credit packs + history")
        goto(page, base, "/dashboard/settings", nav_timeout)
        shoot(page, out, "02-app", "11_settings", "Account settings")
    finally:
        ctx.close()


def capture_admin(browser, base: str, out: Path, email: str, pw: str, nav_timeout: int) -> None:
    print(f"  [03-admin] as admin ({email})")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    try:
        if not login(page, base, email, pw, nav_timeout):
            print("    ✗ admin login failed", file=sys.stderr)
            return

        goto(page, base, "/admin", nav_timeout)
        shoot(page, out, "03-admin", "01_overview", "Admin — platform overview (all accounts)")

        goto(page, base, "/admin/users", nav_timeout)
        shoot(page, out, "03-admin", "02_users", "Admin — every account (credits, roles, jobs)")
        _try("user detail", lambda: (
            page.locator('a[href^="/admin/users/"]').first.click(),
            page.wait_for_url("**/admin/users/**", timeout=nav_timeout),
            # This page streams behind a loading.tsx skeleton; wait for real
            # content (a heading only in page.tsx, not the skeleton) before shot.
            page.get_by_text("Credit ledger").first.wait_for(timeout=nav_timeout),
            page.wait_for_timeout(600),
            shoot(page, out, "03-admin", "03_user_detail",
                  "Admin — a single user's detail + actions")))

        goto(page, base, "/admin/jobs", nav_timeout)
        shoot(page, out, "03-admin", "04_jobs", "Admin — all jobs across accounts")
        _try("job detail", lambda: (
            page.locator('a[href^="/admin/jobs/"]').first.click(),
            page.wait_for_url("**/admin/jobs/**", timeout=nav_timeout),
            page.wait_for_timeout(1800),
            shoot(page, out, "03-admin", "05_job_detail",
                  "Admin — a single job (model vs fallback, errors)")))

        goto(page, base, "/admin/clips", nav_timeout)
        shoot(page, out, "03-admin", "06_clips", "Admin — all rendered clips")
        goto(page, base, "/admin/billing", nav_timeout)
        shoot(page, out, "03-admin", "07_billing", "Admin — revenue / purchases")
        goto(page, base, "/admin/audit", nav_timeout)
        shoot(page, out, "03-admin", "08_audit", "Admin — audit log")
        goto(page, base, "/admin/health", nav_timeout)
        shoot(page, out, "03-admin", "09_health", "Admin — service / provider health")
        goto(page, base, "/admin/providers", nav_timeout)
        shoot(page, out, "03-admin", "10_providers", "Admin — AI providers (keys + active LLM)")
    finally:
        ctx.close()


def write_index(out: Path) -> None:
    lines = [
        "# ClipCast — full-system screenshots",
        "",
        f"Captured {_dt.datetime.now(_dt.timezone.utc):%Y-%m-%d %H:%M UTC} via "
        "`testing/capture_all.py` (real app, real browser).",
        "",
    ]
    section_titles = {
        "01-public": "Public (logged out)",
        "02-app": "Client app (dashboard, Audio Studio, Library, Production Room)",
        "03-admin": "Admin panel",
    }
    current = None
    for section, name, caption in _manifest:
        if section != current:
            current = section
            lines += ["", f"## {section_titles.get(section, section)}", ""]
        lines.append(f"- `{section}/{name}.png` — {caption}")
    lines.append("")
    (out / "INDEX.md").write_text("\n".join(lines))
    print(f"  · wrote {out / 'INDEX.md'} ({len(_manifest)} shots)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO_ROOT / "screenshots"),
                    help="output dir (default: ./screenshots at repo root)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--timeout", type=int, default=90, help="per-nav timeout (s)")
    ap.add_argument("--only", choices=["public", "app", "admin"], nargs="*",
                    help="limit to some sections (default: all)")
    args = ap.parse_args()

    load_env(ENV_FILE)
    base = (os.environ.get("BASE_URL") or "http://localhost:3000").rstrip("/")
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@clipcast.local")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "Admin@1234")
    client_email = os.environ.get("CLIENT_EMAIL", "client@clipcast.local")
    client_pw = os.environ.get("CLIENT_PASSWORD", "Client@1234")
    nav_timeout = args.timeout * 1000
    sections = args.only or ["public", "app", "admin"]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: run with /usr/bin/python3 (Playwright lives there)", file=sys.stderr)
        return 1

    print(f"[{_ts()}] capture_all  base={base}  out={out}")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        try:
            if "public" in sections:
                capture_public(browser, base, out, nav_timeout)
            if "app" in sections:
                capture_app(browser, base, out, client_email, client_pw, nav_timeout)
            if "admin" in sections:
                capture_admin(browser, base, out, admin_email, admin_pw, nav_timeout)
        finally:
            browser.close()

    # Only (re)write INDEX.md on a full run — a partial `--only` run would
    # otherwise clobber the index down to just the sections it captured.
    if not args.only:
        write_index(out)
    else:
        print("  · partial run (--only) — left INDEX.md untouched")
    print(f"[{_ts()}] done — {len(_manifest)} screenshots in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
