#!/usr/bin/env python3
"""Regenerates the informal per-flow .excalidraw diagrams in this folder
from the CURRENT ClipCast architecture. Re-run after changes:

    python3 docs/excalidraw/generate_flows.py

(The formal set — use case, ER, DFD, ... — lives in ../diagrams/ with its
own generator.)
"""
import json
import pathlib
import random

OUT = pathlib.Path(__file__).parent
random.seed(7)

INDIGO = "#6366f1"; SOFT = "#eef2ff"; GREEN = "#15803d"; GREEN_BG = "#dcfce7"
ORANGE = "#c2410c"; ORANGE_BG = "#ffedd5"; RED = "#b91c1c"; RED_BG = "#fee2e2"
GRAY = "#374151"; GRAY_BG = "#f3f4f6"; YELLOW_BG = "#fef9c3"

_id = 0
def nid():
    global _id; _id += 1
    return f"fl{_id}"

def base(t, x, y, w, h, **kw):
    e = {"id": nid(), "type": t, "x": x, "y": y, "width": w, "height": h,
         "angle": 0, "strokeColor": GRAY, "backgroundColor": "transparent",
         "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
         "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None,
         "roundness": {"type": 3} if t == "rectangle" else None,
         "seed": random.randint(1, 2**31), "version": 1,
         "versionNonce": random.randint(1, 2**31), "isDeleted": False,
         "boundElements": [], "updated": 1, "link": None, "locked": False}
    e.update(kw); return e

def text(x, y, s, size=14, color=GRAY, bold=False):
    w = max(len(l) for l in s.split("\n")) * size * 0.55
    h = (s.count("\n") + 1) * size * 1.25
    return base("text", x, y, w, h, text=s, fontSize=size,
                fontFamily=1 if bold else 2, textAlign="left",
                verticalAlign="top", containerId=None, originalText=s,
                lineHeight=1.25, baseline=size)

def box(x, y, w, h, label, bg=SOFT, stroke=INDIGO, size=14, sub=None):
    els = [base("rectangle", x, y, w, h, strokeColor=stroke, backgroundColor=bg, strokeWidth=2)]
    lh = (label.count("\n") + 1) * size * 1.25
    ty = y + (h - lh) / 2 - (7 if sub else 0)
    t = text(0, ty, label, size, stroke, bold=True); t["x"] = x + w/2 - t["width"]/2
    els.append(t)
    if sub:
        st = text(0, ty + lh + 2, sub, 11, GRAY); st["x"] = x + w/2 - st["width"]/2
        els.append(st)
    return els

def arrow(x1, y1, x2, y2, label=None, color=GRAY, dashed=False):
    els = [base("arrow", x1, y1, x2-x1, y2-y1, strokeColor=color, strokeWidth=2,
                strokeStyle="dashed" if dashed else "solid",
                points=[[0,0],[x2-x1,y2-y1]], lastCommittedPoint=None,
                startBinding=None, endBinding=None, startArrowhead=None,
                endArrowhead="arrow", roundness={"type": 2})]
    if label:
        t = text(0, (y1+y2)/2 - 17, label, 12, color)
        t["x"] = (x1+x2)/2 - t["width"]/2
        els.append(t)
    return els

def save(name, els, title):
    doc = {"type": "excalidraw", "version": 2,
           "source": "clipcast flows generator",
           "elements": [text(40, 8, title, 24, INDIGO, bold=True)] + els,
           "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
           "files": {}}
    (OUT / name).write_text(json.dumps(doc, indent=1))
    print("wrote", name)

def chain(steps, x=60, w=280, h=74, gap=44, bg=SOFT, stroke=INDIGO):
    """Vertical chain of boxes with arrows; steps = [(label, sub|None, edge_label|None)]."""
    els, y = [], 70
    for i, (label, sub, edge) in enumerate(steps):
        els += box(x, y, w, h, label, bg, stroke, 13, sub)
        if i < len(steps) - 1:
            els += arrow(x + w/2, y + h, x + w/2, y + h + gap, edge)
        y += h + gap
    return els

# ── 00 end-to-end ─────────────────────────────────────────────────────────────
def e2e():
    els = []
    cols = [
        (40, "USER", GRAY_BG, GRAY, ["Sign up / login\n(password - OAuth - OTP)",
         "Upload MP4 or paste\nYouTube URL + pick mode", "Watch queue live",
         "Play / download clips,\npost to YouTube"]),
        (360, "NEXT.JS + INNGEST", SOFT, INDIGO, ["Server action: gates\n(credits, daily, active)",
         "Duration first: browser\nmetadata / Modal probe", "Durable steps: download,\nprocess, charge, notify",
         "TanStack cache refresh\n(no page re-render)"]),
        (680, "MODAL + S3", GREEN_BG, GREEN, ["Downloader: yt-dlp +\nproxy pool -> S3",
         "GPU: WhisperX -> Gemini\nmoments (mode fan-out)", "TalkNet 9:16 crop +\ncaption pills + watermark",
         "Clips + thumbs -> S3,\npresigned playback"]),
    ]
    for x, head, bg, stroke, items in cols:
        els += box(x, 60, 280, 40, head, bg, stroke, 14)
        y = 130
        for it in items:
            els += box(x, y, 280, 78, it, "#ffffff", stroke, 12)
            if y > 130: els += arrow(x+140, y-32, x+140, y, color=stroke)
            y += 110
    els += arrow(320, 200, 360, 200, "submit")
    els += arrow(640, 320, 680, 320, "events")
    els += arrow(680, 480, 320, 480, "status + clips (poll)", INDIGO, dashed=True)
    els += box(360, 590, 280, 70, "Stripe + ledger", YELLOW_BG, ORANGE, 13,
               "packs -> credits -> CreditTransaction")
    els += box(680, 590, 280, 70, "Email (SMTP/Resend)", YELLOW_BG, ORANGE, 13,
               "OTP - clips ready - failed - weekly")
    save("00-system-design-end-to-end.excalidraw", els, "ClipCast - End-to-End System Design")

# ── 01 pipeline overview (job lifecycle) ─────────────────────────────────────
def pipeline():
    steps = [
        ("queued", "UploadedFile row created; event sent", "check-credits + duration"),
        ("credit gate", "creditsForDuration(real minutes,\nmode, preview) vs balance", "enough? else 'no credits'"),
        ("processing", "errorMessage cleared; YouTube path:\nsubmit download, poll with step.sleep", "S3 source ready"),
        ("GPU render", "transcribe -> moments -> clips\n(step.fetch, server never blocked)", "clips[] + real duration"),
        ("charge + record", "clamped deduction, ledger row,\nClip rows w/ per-clip category", "success"),
        ("processed", "stale errors cleared;\n'clips ready' email queued", None),
    ]
    els = chain(steps, x=80, w=340)
    els += box(520, 300, 250, 90, "failure paths", RED_BG, RED, 13,
               "no moments -> failed, no charge\nfatal -> friendly msg + admin detail\ncancel event -> cancelled")
    els += arrow(420, 340, 520, 340, color=RED, dashed=True)
    save("01-pipeline-overview.excalidraw", els, "ClipCast - Job Lifecycle")

# ── 02 credits & billing ─────────────────────────────────────────────────────
def credits():
    els = chain([
        ("Buy pack", "Stripe Checkout (50/150/500)", "checkout.session.completed"),
        ("Webhook $transaction", "+credits, Purchase row,\nCreditTransaction(+) atomically", "balance up"),
        ("Spend on a job", "1 credit/min ceil - x1.5 All\nx0.5 preview - 1 min floor", "after render"),
        ("True-up deduction", "real duration from Modal,\nclamped at 0 - ledger(-)", None),
    ], x=80, w=340)
    els += box(520, 120, 260, 100, "Ledger everywhere", SOFT, INDIGO, 13,
               "user: Billing -> history\nadmin: user detail page\ntypes: purchase, job_charge,\nadmin_adjust")
    els += box(520, 280, 260, 90, "Gates before spend", YELLOW_BG, ORANGE, 12,
               "credits >= cost - 2 active max\n10/day - 4GB - 240 min")
    save("02-credits-and-billing.excalidraw", els, "ClipCast - Credits & Billing")

# ── 03 video processing internals ────────────────────────────────────────────
def processing():
    els = chain([
        ("WhisperX large-v2", "transcribe + align ->\nper-word timestamps", "words"),
        ("Sentence windows", "compact rows, bounded chunks\n(4h scales like 20min)", "per chunk x mode"),
        ("Gemini 2.5 Flash", "mode prompt (fan-out for All,\nopen-ended Any) - HF fallback", "moments JSON"),
        ("Validate", "<=12 clips, 0<len<=120s,\ninside video, titles capped", "per moment"),
        ("TalkNet ASD", "active-speaker 9:16 crop\n(preview: fast center crop)", "vertical mp4"),
        ("captions.py", "white Poppins, pill on active\nword, bounce; user color", "burned"),
        ("Watermark + upload", "user text or none;\nclip + thumb -> S3", None),
    ], x=80, w=340, h=68, gap=36)
    save("03-video-processing.excalidraw", els, "ClipCast - GPU Processing Internals")

# ── 04 youtube ingestion ─────────────────────────────────────────────────────
def youtube():
    els = chain([
        ("Connect channel", "Google OAuth (state=userId),\nmulti-channel picker if needed", "tokens stored"),
        ("Submit URL / cron", "manual paste, or daily 09:00 UTC\nauto-clip (idempotent by URL)", "job queued"),
        ("Duration probe", "get_youtube_duration:\n--skip-download, ~seconds", "gate credits first"),
        ("Cloud download", "yt-dlp via ranked proxy pool,\n202 + call_id, polled", "source -> S3"),
        ("Post clip back", "resumable upload API,\nyoutubeVideoId saved", None),
    ], x=80, w=350)
    els += box(530, 210, 250, 100, "Proxy pool", GREEN_BG, GREEN, 13,
               "yt-dlp-proxy refresh every 15m\n-> Modal Volume; request path\nonly reads ranked list")
    save("04-youtube-ingestion.excalidraw", els, "ClipCast - YouTube Ingestion & Upload")

# ── 05 realtime state ────────────────────────────────────────────────────────
def state():
    els = []
    els += box(80, 80, 320, 90, "dashboard/layout.tsx (server)", SOFT, INDIGO, 13,
               "fetch usage+queue once\nsetQueryData + HydrationBoundary")
    els += box(80, 230, 320, 90, "useQueueStatus(select)", SOFT, INDIGO, 13,
               "key ['queue-status'] in lib/ (plain\nmodule - never in 'use client')")
    els += box(80, 380, 320, 100, "Subscribers (slices)", "#ffffff", INDIGO, 12,
               "sidebar credits - topbar pill\nhero stats - uploader gates\nqueue table (memo rows)")
    els += box(490, 230, 290, 90, "Polling", GREEN_BG, GREEN, 13,
               "10s fresh job - 30s long GPU\n20s idle - paused hidden tab")
    els += box(490, 380, 290, 100, "Mutations", YELLOW_BG, ORANGE, 12,
               "submit/retry/cancel/clear ->\nrefetchQueries only\n(no revalidatePath re-render)")
    els += arrow(240, 170, 240, 230, "seeded cache")
    els += arrow(240, 320, 240, 380, "structural sharing:\nunchanged => zero renders")
    els += arrow(490, 275, 400, 275, color=GREEN)
    els += arrow(490, 430, 400, 430, color=ORANGE)
    save("05-realtime-state-tanstack.excalidraw", els, "ClipCast - Live Data & Re-render Strategy")

# ── 06 email & notifications ─────────────────────────────────────────────────
def email():
    els = chain([
        ("Trigger", "job done/failed - OTP request -\nMonday weekly cron", "queueEmail()"),
        ("Inngest email/send", "sendEmailFn, 3 retries -\nnever blocks the mutation", "sendMail()"),
        ("Transport chain", "SMTP (Gmail app password)\n-> Resend -> console log", "delivered"),
        ("User prefs", "notify* toggles in Settings\nchecked before queueing", None),
    ], x=80, w=350)
    els += box(530, 120, 260, 110, "Templates (mail.ts)", SOFT, INDIGO, 12,
               "shared layout, brand button\notp - clipReady - jobFailed\nweeklySummary")
    save("06-email-and-notifications.excalidraw", els, "ClipCast - Email Pipeline")

# ── 07 captions rendering ────────────────────────────────────────────────────
def captions():
    els = chain([
        ("Word timestamps", "from WhisperX (same data\nas moment selection)", "chunk 2-4 words"),
        ("Layout (Pillow)", "em derived from OS/2\nwinAscent+winDescent = Fontsize", "exact word x/y"),
        ("ASS events", "1 static text event per chunk\n+ 1 pill drawing per word", "no flicker"),
        ("Pill style", "user color (default indigo),\nrounded, \\fscx bounce 70->112->100", "ffmpeg ass= burn"),
        ("Verify visually", "scripts/render_caption_test.py\n(Modal CPU, PNG frames)", None),
    ], x=80, w=360, h=70, gap=38)
    save("07-captions-rendering.excalidraw", els, "ClipCast - Caption Rendering")

# ── 08 auth flows ────────────────────────────────────────────────────────────
def auth():
    els = []
    heads = [("Password", 60), ("Google / Discord", 380), ("Email OTP", 700)]
    flows = [
        ["login form", "credentials provider\nbcrypt compare", "banned? reject"],
        ["OAuth consent", "account linking by email\n(dangerous linking on)", "JWT session"],
        ["request code -> email", "LoginOtp: hash, 10min,\n5 tries, single-use", "verify inside authorize()"],
    ]
    for (h, x), steps in zip(heads, flows):
        els += box(x, 70, 280, 40, h, SOFT, INDIGO, 14)
        y = 140
        for s in steps:
            els += box(x, y, 280, 64, s, "#ffffff", INDIGO, 12)
            if y > 140: els += arrow(x+140, y-32, x+140, y)
            y += 96
    els += box(380, 460, 280, 80, "/post-login", GREEN_BG, GREEN, 13,
               "role check server-side:\nADMIN -> /admin, else /dashboard")
    for x in (200, 520, 840):
        els += arrow(x, 428, 520, 460, color=GREEN)
    save("08-auth-flows.excalidraw", els, "ClipCast - Authentication Flows")

# ── 09 clip modes ────────────────────────────────────────────────────────────
def modes():
    els = []
    els += box(80, 80, 300, 60, "clip_mode from user", SOFT, INDIGO, 13,
               "All - Any - Q&A - Educational\nMotivational - Highlights")
    els += box(80, 210, 300, 70, "single mode", "#ffffff", INDIGO, 12,
               "one targeted prompt per chunk\nempty result ok (no charge)")
    els += box(480, 210, 330, 70, "All = fan-out", ORANGE_BG, ORANGE, 12,
               "5 passes (4 fixed + any),\n>50% overlap dedupe, x1.5 credits")
    els += box(480, 330, 330, 70, "Any = model decides", GREEN_BG, GREEN, 12,
               "infers episode type, invents 1-3\nword category tag per clip")
    els += box(280, 460, 330, 70, "per-clip category", SOFT, INDIGO, 12,
               "returned to frontend -> stored as\nClip.clipMode (badges in UI)")
    els += arrow(230, 140, 230, 210)
    els += arrow(380, 110, 640, 210, "All", ORANGE)
    els += arrow(380, 130, 640, 330, "Any", GREEN)
    els += arrow(230, 280, 380, 480)
    els += arrow(640, 280, 540, 460, color=ORANGE)
    els += arrow(640, 400, 520, 460, color=GREEN)
    save("09-clip-modes-ai.excalidraw", els, "ClipCast - Clip Modes & AI Selection")

# ── 10 admin & audit ─────────────────────────────────────────────────────────
def admin():
    els = []
    pages = ["Overview stats", "Users (credits, ban,\nrole, detail+ledger)",
             "Jobs (filter, reset)", "Clips (delete record)",
             "Billing (revenue,\npurchases)", "Audit log"]
    y = 80
    for p in pages:
        els += box(80, y, 260, 62, p, SOFT, INDIGO, 12)
        y += 78
    els += box(460, 150, 300, 90, "Guards", YELLOW_BG, ORANGE, 13,
               "layout: role ADMIN or redirect\nevery action: requireAdmin()\nthemed confirms on destructive ops")
    els += box(460, 300, 300, 90, "AdminAuditLog", GREEN_BG, GREEN, 13,
               "who/what/target/detail per\nmutation - survives admin\ndeletion (SetNull + email copy)")
    els += arrow(340, 260, 460, 200)
    els += arrow(340, 340, 460, 340)
    save("10-admin-and-audit.excalidraw", els, "ClipCast - Admin Panel & Audit")

e2e(); pipeline(); credits(); processing(); youtube(); state(); email(); captions(); auth(); modes(); admin()
print("done")
