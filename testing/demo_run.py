#!/usr/bin/env python3
"""
ClipCast UI demo driver — drives the REAL app through a browser (Playwright) as
the seeded client, submits real clip/audio jobs, and screenshots each stage into
a demo report dir. Complements the headless checks in `page_smoke.py` and the
Modal-side `e2e_full_pipeline.py`.

Actions (stateful across calls via a saved storage_state):
  login   : sign in as the client, save auth to <out>/client_state.json
  clip    : (login if needed) submit a YouTube URL through the Uploader, shoot
            dashboard + queue
  audio   : (login if needed) submit an Audio Studio "Compose" job, shoot studio + queue
  shots   : re-screenshot a set of routes using the saved auth (for monitoring
            progress + final results)

Prereqs: dev server (npm run dev) + Inngest worker (npm run inngest-dev) up, DB
seeded (npx tsx prisma/seed.ts), Modal endpoints configured in repo-root .env.

Examples:
  python3 testing/demo_run.py clip  --out testing/reports/demo-XYZ \
      --url "https://www.youtube.com/watch?v=arj7oStGLkU" --mode highlights
  python3 testing/demo_run.py shots --out testing/reports/demo-XYZ \
      --routes /dashboard/queue=queue /dashboard/clips=clips
  python3 testing/demo_run.py audio --out testing/reports/demo-XYZ \
      --prompt "warm lofi hip hop, jazzy keys, relaxed" --genre lofi
Uses ADMIN_/CLIENT_ creds from .env (defaults match the seed).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
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


def shoot(page, out: Path, name: str) -> Path:
    p = out / f"{name}.png"
    page.screenshot(path=str(p), full_page=True)
    print(f"    · shot {p.name}")
    return p


def login_client(context, page, base: str, email: str, pw: str, nav_timeout: int) -> bool:
    page.goto(f"{base}/login", wait_until="domcontentloaded", timeout=nav_timeout)
    page.fill('input[name="email"]', email)
    page.fill('input[name="password"]', pw)
    page.click('button[type="submit"]')
    try:
        page.wait_for_url("**/dashboard**", timeout=nav_timeout)
    except Exception:
        pass
    return "/login" not in page.url


def ensure_context(pw, out: Path, base: str, email: str, pwd: str, nav_timeout: int, headed: bool):
    """Return (browser, context, page), reusing saved auth when present."""
    browser = pw.chromium.launch(headless=not headed)
    state = out / "client_state.json"
    if state.exists():
        context = browser.new_context(viewport={"width": 1440, "height": 900},
                                      storage_state=str(state))
        page = context.new_page()
        # cheap auth probe
        page.goto(f"{base}/dashboard", wait_until="domcontentloaded", timeout=nav_timeout)
        if "/login" not in page.url:
            print(f"  ✓ reused saved auth ({email})")
            return browser, context, page
        context.close()
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    if not login_client(context, page, base, email, pwd, nav_timeout):
        print("  ✗ login failed — dev server up? DB seeded?", file=sys.stderr)
        browser.close()
        sys.exit(1)
    context.storage_state(path=str(state))
    print(f"  ✓ logged in as {email} → {page.url}")
    return browser, context, page


def do_clip(page, out: Path, base: str, url: str, mode: str, preview: bool, nav_timeout: int):
    print(f"  → clip submit: mode={mode} preview={preview}\n    {url}")
    page.goto(f"{base}/dashboard", wait_until="domcontentloaded", timeout=nav_timeout)
    page.wait_for_timeout(1500)
    shoot(page, out, "01_dashboard_before")
    # Switch to the YouTube URL tab
    page.get_by_role("button", name="YouTube URL").click()
    page.wait_for_timeout(400)
    # Pick clip mode chip (All/Any/Q&A/Educational/Motivational/Highlights)
    label = {"all": "All", "any": "Any", "qa": "Q&A", "educational": "Educational",
             "motivational": "Motivational", "highlights": "Highlights"}.get(mode, "Highlights")
    try:
        page.get_by_role("button", name=label, exact=True).click()
    except Exception:
        print(f"    ! could not click mode chip '{label}', using default")
    if preview:
        page.get_by_role("checkbox").check()
    page.fill('input[type="url"]', url)
    page.wait_for_timeout(300)
    shoot(page, out, "02_youtube_filled")
    page.get_by_role("button", name="Generate clips").click()
    # Wait for the success toast / queue update
    page.wait_for_timeout(4000)
    shoot(page, out, "03_after_submit")
    page.goto(f"{base}/dashboard/queue", wait_until="domcontentloaded", timeout=nav_timeout)
    page.wait_for_timeout(2500)
    shoot(page, out, "04_queue_submitted")
    print("  ✓ clip job submitted (now downloading/processing on the backend)")


def do_audio(page, out: Path, base: str, prompt: str, genre: str, nav_timeout: int):
    print(f"  → audio submit (Compose): genre={genre}\n    {prompt!r}")
    page.goto(f"{base}/dashboard/audio", wait_until="domcontentloaded", timeout=nav_timeout)
    page.wait_for_timeout(1500)
    shoot(page, out, "A1_audio_studio")
    page.get_by_role("button", name="Compose").click()
    page.wait_for_timeout(500)
    page.fill("#prompt", prompt)
    try:
        page.select_option("#genre", genre)
    except Exception:
        pass
    page.wait_for_timeout(300)
    shoot(page, out, "A2_compose_filled")
    page.get_by_role("button", name="Compose track").click()
    page.wait_for_timeout(4000)  # submit → router.push(/dashboard/queue)
    shoot(page, out, "A3_audio_submitted")
    print("  ✓ audio job submitted")


def do_shots(page, out: Path, base: str, routes: list[str], nav_timeout: int):
    for spec in routes:
        route, _, name = spec.partition("=")
        name = name or route.strip("/").replace("/", "_") or "root"
        page.goto(f"{base}{route}", wait_until="domcontentloaded", timeout=nav_timeout)
        page.wait_for_timeout(2500)
        shoot(page, out, name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["login", "clip", "audio", "shots"])
    ap.add_argument("--out", required=True, help="demo report dir (created if absent)")
    ap.add_argument("--url", default="")
    ap.add_argument("--mode", default="highlights")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--genre", default="auto")
    ap.add_argument("--routes", nargs="*", default=[])
    ap.add_argument("--as-admin", action="store_true", help="use admin creds instead of client")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--timeout", type=int, default=90)
    args = ap.parse_args()

    load_env(ENV_FILE)
    base = (os.environ.get("BASE_URL") or "http://localhost:3000").rstrip("/")
    if args.as_admin:
        email = os.environ.get("ADMIN_EMAIL", "admin@clipcast.local")
        pwd = os.environ.get("ADMIN_PASSWORD", "Admin@1234")
    else:
        email = os.environ.get("CLIENT_EMAIL", "client@clipcast.local")
        pwd = os.environ.get("CLIENT_PASSWORD", "Client@1234")
    nav_timeout = args.timeout * 1000

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: run with /usr/bin/python3 (Playwright lives there)", file=sys.stderr)
        return 1

    print(f"[{_ts()}] demo:{args.action}  base={base}  out={out}")
    with sync_playwright() as pw:
        browser, context, page = ensure_context(pw, out, base, email, pwd, nav_timeout, args.headed)
        try:
            if args.action == "login":
                pass
            elif args.action == "clip":
                do_clip(page, out, base, args.url, args.mode, args.preview, nav_timeout)
            elif args.action == "audio":
                do_audio(page, out, base, args.prompt, args.genre, nav_timeout)
            elif args.action == "shots":
                do_shots(page, out, base, args.routes, nav_timeout)
            context.storage_state(path=str(out / "client_state.json"))
        finally:
            browser.close()
    print(f"[{_ts()}] done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
