#!/usr/bin/env python3
"""Regenerates every .excalidraw diagram in this folder from the CURRENT
ClipCast architecture. Edit the specs below and re-run:

    python3 docs/diagrams/generate_diagrams.py

Each diagram opens in excalidraw.com / the VS Code Excalidraw extension and
stays fully editable (plain shapes, no images).
"""
import json
import pathlib
import random

OUT = pathlib.Path(__file__).parent
random.seed(42)

INDIGO = "#6366f1"
SOFT = "#eef2ff"
GREEN = "#15803d"
GREEN_BG = "#dcfce7"
ORANGE = "#c2410c"
ORANGE_BG = "#ffedd5"
RED = "#b91c1c"
RED_BG = "#fee2e2"
GRAY = "#374151"
GRAY_BG = "#f3f4f6"
YELLOW_BG = "#fef9c3"

_id = 0
def nid():
    global _id
    _id += 1
    return f"el{_id}"

def base(t, x, y, w, h, **kw):
    e = {
        "id": nid(), "type": t, "x": x, "y": y, "width": w, "height": h,
        "angle": 0, "strokeColor": GRAY, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
        "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None,
        "roundness": {"type": 3} if t == "rectangle" else None,
        "seed": random.randint(1, 2**31), "version": 1,
        "versionNonce": random.randint(1, 2**31), "isDeleted": False,
        "boundElements": [], "updated": 1, "link": None, "locked": False,
    }
    e.update(kw)
    return e

def text(x, y, s, size=16, color=GRAY, align="left", bold=False):
    w = max(len(line) for line in s.split("\n")) * size * 0.55
    h = s.count("\n") * size * 1.25 + size * 1.25
    return base("text", x, y, w, h, text=s, fontSize=size,
                fontFamily=2 if not bold else 1, textAlign=align,
                verticalAlign="top", containerId=None, originalText=s,
                lineHeight=1.25, baseline=size)

def box(x, y, w, h, label, bg=SOFT, stroke=INDIGO, size=15, sublabel=None):
    """Rectangle + centered label (as separate text element)."""
    els = [base("rectangle", x, y, w, h, strokeColor=stroke, backgroundColor=bg, strokeWidth=2)]
    lines = label.split("\n")
    th = len(lines) * size * 1.25
    ty = y + (h - th) / 2 - (8 if sublabel else 0)
    t = text(x + w / 2, ty, label, size=size, color=stroke, align="center", bold=True)
    t["x"] = x + w / 2 - t["width"] / 2
    els.append(t)
    if sublabel:
        st = text(x + w / 2, ty + th + 2, sublabel, size=11, color=GRAY, align="center")
        st["x"] = x + w / 2 - st["width"] / 2
        els.append(st)
    return els

def arrow(x1, y1, x2, y2, label=None, color=GRAY, dashed=False):
    els = [base("arrow", x1, y1, x2 - x1, y2 - y1, strokeColor=color,
                strokeWidth=2, strokeStyle="dashed" if dashed else "solid",
                points=[[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint=None,
                startBinding=None, endBinding=None, startArrowhead=None,
                endArrowhead="arrow", roundness={"type": 2})]
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        t = text(mx, my - 18, label, size=12, color=color, align="center")
        t["x"] = mx - t["width"] / 2
        els.append(t)
    return els

def ellipse(x, y, w, h, label, bg=GREEN_BG, stroke=GREEN, size=13):
    els = [base("ellipse", x, y, w, h, strokeColor=stroke, backgroundColor=bg, strokeWidth=2)]
    t = text(x + w / 2, y + h / 2 - size * 0.7, label, size=size, color=stroke, align="center", bold=True)
    t["x"] = x + w / 2 - t["width"] / 2
    els.append(t)
    return els

def diamond(x, y, w, h, label, bg=YELLOW_BG, stroke=ORANGE, size=12):
    els = [base("diamond", x, y, w, h, strokeColor=stroke, backgroundColor=bg, strokeWidth=2)]
    t = text(x + w / 2, y + h / 2 - size * 0.7, label, size=size, color=stroke, align="center", bold=True)
    t["x"] = x + w / 2 - t["width"] / 2
    els.append(t)
    return els

def save(name, elements, title):
    els = list(text(40, 10, title, size=24, color=INDIGO, bold=True))
    doc = {
        "type": "excalidraw", "version": 2,
        "source": "clipcast docs generator",
        "elements": [els if isinstance(els, dict) else els][0] and [],
        "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
        "files": {},
    }
    doc["elements"] = [text(40, 10, title, size=24, color=INDIGO, bold=True)] + elements
    (OUT / name).write_text(json.dumps(doc, indent=1))
    print(f"wrote {name} ({len(doc['elements'])} elements)")

E = []  # scratch


# ── 01 Use-case ───────────────────────────────────────────────────────────────
def usecase():
    els = []
    els += ellipse(60, 320, 120, 60, "Creator\n(User)", SOFT, INDIGO)
    els += ellipse(60, 720, 120, 60, "Admin", ORANGE_BG, ORANGE)
    cases_user = [
        "Sign up / Login (password,\nGoogle, Discord, email OTP)",
        "Upload MP4 / paste YouTube URL",
        "Pick clip mode (All/Any/Q&A/\nEducational/Motivational/Highlights)",
        "Track queue, retry, cancel, clear",
        "Play / download / delete clips",
        "Post clip to YouTube channel",
        "Buy credit packs (Stripe)",
        "View credit ledger",
        "Connect YouTube + auto-clip daily",
        "Set caption color & watermark",
        "Email notification toggles",
    ]
    cases_admin = [
        "Manage users (credits, ban, role)",
        "Monitor & reset jobs",
        "Delete clip records",
        "View revenue & purchases",
        "Review admin audit log",
    ]
    y = 80
    for c in cases_user:
        els += ellipse(420, y, 330, 56, c, "#ffffff", INDIGO, 12)
        els += arrow(180, 350, 420, y + 28, color=INDIGO)
        y += 68
    y = 640
    for c in cases_admin:
        els += ellipse(420, y, 330, 52, c, "#ffffff", ORANGE, 12)
        els += arrow(180, 750, 420, y + 26, color=ORANGE)
        y += 62
    save("01-use-case-diagram.excalidraw", els, "ClipCast - Use Case Diagram")


# ── 02 System architecture ────────────────────────────────────────────────────
def architecture():
    els = []
    els += box(40, 90, 220, 130, "Browser (React 19)",
               sublabel="Next.js App Router UI\nTanStack Query cache\n(poll /api/queue-status)")
    els += box(360, 60, 260, 340, "Next.js 16 server\n(clipcast-frontend)", GRAY_BG, GRAY,
               sublabel="Server Components + Actions\nNextAuth (JWT) - /api routes\nPrisma ORM")
    els += box(360, 470, 260, 110, "Inngest\n(durable functions)", YELLOW_BG, ORANGE,
               sublabel="process-video - send-email\ndaily-clip-scheduler (cron)\nweekly-summary (cron)")
    els += box(760, 60, 240, 110, "Modal: downloader\n(CPU)", GREEN_BG, GREEN,
               sublabel="yt-dlp + proxy pool -> S3\nget_youtube_duration probe")
    els += box(760, 220, 240, 130, "Modal: processor\n(L40S GPU)", GREEN_BG, GREEN,
               sublabel="WhisperX - Gemini 2.5 Flash\nTalkNet ASD - ffmpeg+libass\ncaptions.py pill subtitles")
    els += box(760, 420, 240, 90, "AWS S3", SOFT, INDIGO,
               sublabel="source videos - clips\nthumbnails (presigned URLs)")
    els += box(360, 640, 260, 90, "Supabase Postgres", SOFT, INDIGO,
               sublabel="User, UploadedFile, Clip,\nPurchase, CreditTransaction, ...")
    els += box(40, 470, 220, 90, "Stripe", GRAY_BG, GRAY,
               sublabel="Checkout + webhook\ncredit packs")
    els += box(40, 620, 220, 90, "Gmail SMTP / Resend", GRAY_BG, GRAY,
               sublabel="OTP - clip ready - job failed\nweekly summary emails")
    els += box(40, 280, 220, 90, "YouTube / Google", RED_BG, RED,
               sublabel="OAuth - Data API v3\nsource videos - clip upload")
    els += arrow(260, 150, 360, 150, "HTTPS / RSC / actions")
    els += arrow(490, 400, 490, 470, "events")
    els += arrow(620, 500, 760, 115, "submit / poll download", GREEN)
    els += arrow(620, 520, 760, 280, "step.fetch process_video", GREEN)
    els += arrow(880, 170, 880, 220, "S3 key", GREEN)
    els += arrow(880, 350, 880, 420, "clips + thumbs", GREEN)
    els += arrow(490, 580, 490, 640, "Prisma")
    els += arrow(260, 515, 360, 515, "webhook", GRAY)
    els += arrow(360, 680, 260, 665, "queued emails", GRAY, dashed=True)
    els += arrow(260, 325, 360, 300, "OAuth callback", RED)
    els += arrow(760, 100, 260, 310, "yt-dlp download", RED, dashed=True)
    save("02-system-architecture-diagram.excalidraw", els, "ClipCast - System Architecture")


# ── 03 Flowchart: submit -> clips ────────────────────────────────────────────
def flowchart():
    els = []
    els += ellipse(420, 60, 180, 50, "Start: user submits", GREEN_BG, GREEN)
    els += diamond(400, 150, 220, 70, "Upload or YouTube URL?")
    els += box(120, 260, 220, 70, "Read duration in browser\n(<video> metadata)", SOFT, INDIGO, 12)
    els += box(660, 260, 240, 70, "Modal duration probe\n(yt-dlp --skip-download)", GREEN_BG, GREEN, 12)
    els += diamond(400, 380, 220, 80, "credits >=\ncreditsForDuration()?")
    els += box(700, 400, 200, 50, "status: no credits", RED_BG, RED, 12)
    els += box(120, 490, 240, 60, "Presigned PUT -> S3\n(direct upload)", SOFT, INDIGO, 12)
    els += box(660, 490, 240, 60, "Modal downloader -> S3\n(proxy pool, polled)", GREEN_BG, GREEN, 12)
    els += box(390, 600, 240, 70, "GPU processor: WhisperX\ntranscribe (word timestamps)", GREEN_BG, GREEN, 12)
    els += box(390, 700, 240, 70, "Gemini picks moments\n(mode prompts, fan-out for All)", GREEN_BG, GREEN, 12)
    els += diamond(400, 800, 220, 70, "clips found?")
    els += box(700, 810, 220, 60, "fail job, no charge,\nemail 'job failed'", RED_BG, RED, 12)
    els += box(390, 910, 240, 80, "Per clip: TalkNet crop 9:16\ncaptions.py pill subtitles\nwatermark -> S3", GREEN_BG, GREEN, 12)
    els += box(390, 1020, 240, 70, "Deduct credits (clamped),\nledger row, status processed", SOFT, INDIGO, 12)
    els += ellipse(400, 1120, 220, 50, "Email 'clips ready' - done", GREEN_BG, GREEN)
    els += arrow(510, 110, 510, 150)
    els += arrow(400, 185, 230, 260, "MP4 upload")
    els += arrow(620, 185, 780, 260, "YouTube URL")
    els += arrow(230, 330, 460, 380)
    els += arrow(780, 330, 560, 380)
    els += arrow(620, 420, 700, 425, "no", RED)
    els += arrow(400, 430, 240, 490, "yes")
    els += arrow(560, 430, 780, 490, "yes")
    els += arrow(240, 550, 470, 600)
    els += arrow(780, 550, 550, 600)
    els += arrow(510, 670, 510, 700)
    els += arrow(510, 770, 510, 800)
    els += arrow(620, 835, 700, 840, "no", RED)
    els += arrow(510, 870, 510, 910, "yes")
    els += arrow(510, 990, 510, 1020)
    els += arrow(510, 1090, 510, 1120)
    save("03-flowchart.excalidraw", els, "ClipCast - Job Flowchart (submit to clips)")


# ── 04 Activity: credits & billing ───────────────────────────────────────────
def activity():
    els = []
    els += ellipse(430, 60, 160, 46, "User needs credits", GREEN_BG, GREEN)
    els += box(400, 140, 220, 54, "Billing page: pick pack\n(50 / 150 / 500)", SOFT, INDIGO, 12)
    els += box(400, 230, 220, 54, "createCheckoutSession\n-> Stripe Checkout", GRAY_BG, GRAY, 12)
    els += diamond(410, 320, 200, 64, "payment succeeds?")
    els += box(720, 330, 190, 50, "back to app,\nno change", RED_BG, RED, 12)
    els += box(380, 430, 260, 84, "Stripe webhook ($transaction):\n+credits, Purchase row,\nCreditTransaction row", SOFT, INDIGO, 12)
    els += box(400, 560, 220, 54, "Ledger visible to user\n+ admin user detail", SOFT, INDIGO, 12)
    els += box(60, 430, 240, 84, "Spend: job charge\ncreditsForDuration(min)\nx1.5 All - x0.5 preview", GREEN_BG, GREEN, 12)
    els += box(60, 560, 240, 64, "deduct clamped at 0,\nledger 'job_charge' row", GREEN_BG, GREEN, 12)
    els += ellipse(430, 660, 160, 46, "Balance updated", GREEN_BG, GREEN)
    els += arrow(510, 106, 510, 140)
    els += arrow(510, 194, 510, 230)
    els += arrow(510, 284, 510, 320)
    els += arrow(610, 352, 720, 352, "no", RED)
    els += arrow(510, 384, 510, 430, "yes")
    els += arrow(510, 514, 510, 560)
    els += arrow(180, 514, 180, 560)
    els += arrow(180, 624, 430, 683)
    els += arrow(510, 614, 510, 660)
    els += arrow(60, 472, 30, 472)
    save("04-activity-diagram.excalidraw", els, "ClipCast - Activity: Credits & Billing")


# ── 05 Sequence: YouTube job ─────────────────────────────────────────────────
def sequence():
    els = []
    actors = [("Browser", 60), ("Next server\n(actions)", 260), ("Inngest fn", 470),
              ("Modal\ndownloader", 680), ("Modal GPU\nprocessor", 880), ("S3 / DB", 1090)]
    for name, x in actors:
        els += box(x, 70, 150, 54, name, SOFT, INDIGO, 12)
        els += [base("line", x + 75, 124, 0, 900, strokeColor="#9ca3af",
                     strokeStyle="dashed", points=[[0, 0], [0, 900]],
                     lastCommittedPoint=None, startBinding=None, endBinding=None,
                     startArrowhead=None, endArrowhead=None)]
    seq = [
        (135, 335, 170, "processYoutubeVideo(url, mode)"),
        (335, 1165, 210, "create UploadedFile (queued)"),
        (335, 545, 250, "send process-video event"),
        (545, 755, 300, "get_youtube_duration (probe)"),
        (545, 1165, 345, "credit gate: creditsForDuration"),
        (545, 755, 390, "submit download (202 + call_id)"),
        (545, 755, 430, "poll status (step.sleep between)"),
        (755, 1165, 470, "video -> S3"),
        (545, 955, 520, "step.fetch process_video(s3_key, mode,\ncaption_color, watermark)"),
        (955, 1165, 580, "WhisperX -> Gemini -> render clips -> S3"),
        (545, 1165, 640, "create Clip rows (per-clip category)"),
        (545, 1165, 680, "deduct credits + ledger row"),
        (545, 335, 730, "queue 'clips ready' email"),
        (135, 335, 790, "TanStack poll /api/queue-status"),
        (335, 135, 830, "COMPLETED + clips"),
    ]
    for x1, x2, y, label in seq:
        els += arrow(x1, y, x2, y, label)
    save("05-sequence-diagram.excalidraw", els, "ClipCast - Sequence: YouTube URL to Clips")


# ── 06 Class (domain modules) ────────────────────────────────────────────────
def classes():
    els = []
    mods = [
        (40, 80, "actions/generation.ts", "processVideo()\nprocessYoutubeVideo()\nclearQueueItem()"),
        (300, 80, "actions/stripe.ts", "createCheckoutSession()\ngetMyCreditTransactions()"),
        (560, 80, "actions/youtube.ts", "OAuth URL / disconnect\nselect channel / auto-clip\ngetChannelVideos()\nuploadClipToYouTube()"),
        (820, 80, "actions/admin.ts", "getAdminStats/Users/Jobs/...\nadjustUserCredits()\nsetUserBanned/Role()\nreset jobs / delete clip"),
        (40, 260, "lib/credits.ts", "creditsForDuration(sec,\n {clipMode, isPreview})\nALL x1.5 - preview x0.5"),
        (300, 260, "server/mail.ts", "sendMail() SMTP->Resend\nqueueEmail() via Inngest\notp/clipReady/jobFailed html"),
        (560, 260, "inngest/functions.ts", "processVideoFn\nsendEmailFn\ndailyClipScheduler\nweeklySummaryScheduler"),
        (820, 280, "processor/captions.py", "build_caption_subs()\nlayout via OS/2 win metrics\npill highlight + bounce"),
        (40, 440, "hooks/use-queue-status.ts", "useQueueStatus(select)\nuseRefreshQueueStatus()\nadaptive refetchInterval"),
        (300, 440, "types/ (barrel)", "QueueFile - ClipItem\nActionResult - AdminUser\nPriceId - NotificationPref"),
        (560, 460, "server/otp.ts + auth", "createLoginOtp()\nverifyAndConsumeLoginOtp()\nNextAuth providers x4"),
        (820, 470, "processor/main.py", "process_video endpoint\nidentify_moments fan-out\nprocess_clip / preview"),
    ]
    for x, y, title, body in mods:
        els += box(x, y, 230, 60, title, SOFT, INDIGO, 12)
        els += [text(x + 10, y + 64, body, size=11)]
    save("06-class-diagram.excalidraw", els, "ClipCast - Module/Class Diagram")


# ── 07 ER diagram ────────────────────────────────────────────────────────────
def er():
    els = []
    ents = [
        (60, 80, "User", "id PK - email - password?\nrole - banned - credits\nyoutube* (channel, tokens,\nautoClip) - notify* x4\ncaptionColor - watermarkText"),
        (420, 80, "UploadedFile", "id PK - userId FK\ns3Key - youtubeUrl?\nstatus - clipMode - isPreview\nduration - errorMessage\ninternalErrorDetail"),
        (760, 80, "Clip", "id PK - userId FK\nuploadedFileId FK?\ns3Key - title - duration\nthumbnailS3Key - clipMode\nyoutubeVideoId?"),
        (60, 320, "Purchase", "id PK - userId FK\nstripeSessionId UQ\npack - credits\namountTotal - currency"),
        (420, 320, "CreditTransaction", "id PK - userId FK\ntype - amount (signed)\nbalanceAfter\nuploadedFileId? purchaseId?"),
        (760, 320, "AdminAuditLog", "id PK - adminId FK? (SetNull)\nadminEmail - action\ntargetType - targetId - detail"),
        (60, 520, "LoginOtp", "id PK - email\ncodeHash - expiresAt\nconsumedAt? - attempts"),
        (420, 520, "Account / Session /\nVerificationToken", "NextAuth adapter tables\n(OAuth links, sessions)"),
    ]
    for x, y, name, body in ents:
        els += box(x, y, 260, 44, name, SOFT, INDIGO, 14)
        els += [base("rectangle", x, y + 44, 260, 120, strokeColor=INDIGO, backgroundColor="#ffffff")]
        els += [text(x + 10, y + 52, body, size=11)]
    rel = [
        (320, 130, 420, 130, "1 : N owns"),
        (680, 130, 760, 130, "1 : N produces"),
        (190, 244, 190, 320, "1 : N buys"),
        (480, 244, 480, 320, "charges ref"),
        (320, 380, 420, 380, "1 : N ledger"),
        (190, 484, 190, 520, "by email"),
        (890, 244, 890, 320, "admin acts"),
    ]
    for x1, y1, x2, y2, lbl in rel:
        els += arrow(x1, y1, x2, y2, lbl, INDIGO)
    save("07-er-diagram.excalidraw", els, "ClipCast - ER Diagram (Prisma / Postgres)")


# ── 08 DFD level 0 ───────────────────────────────────────────────────────────
def dfd0():
    els = []
    els += box(60, 260, 180, 70, "Creator", GRAY_BG, GRAY)
    els += box(60, 420, 180, 70, "Admin", GRAY_BG, GRAY)
    els += ellipse(420, 300, 260, 130, "0\nClipCast Platform", SOFT, INDIGO, 16)
    els += box(860, 120, 200, 60, "Stripe", GRAY_BG, GRAY)
    els += box(860, 240, 200, 60, "YouTube / Google", GRAY_BG, GRAY)
    els += box(860, 360, 200, 60, "Modal (GPU/CPU)", GRAY_BG, GRAY)
    els += box(860, 480, 200, 60, "AWS S3", GRAY_BG, GRAY)
    els += box(860, 600, 200, 60, "SMTP / Resend", GRAY_BG, GRAY)
    els += arrow(240, 290, 420, 340, "videos, URLs, settings")
    els += arrow(420, 390, 240, 320, "clips, queue status, ledger")
    els += arrow(240, 450, 430, 400, "moderation, credit adjust")
    els += arrow(680, 320, 860, 150, "checkout / webhook")
    els += arrow(680, 340, 860, 270, "OAuth, downloads, uploads")
    els += arrow(680, 365, 860, 390, "process jobs")
    els += arrow(680, 390, 860, 510, "store/read media")
    els += arrow(680, 415, 860, 630, "notification emails")
    save("08-dfd-level0-context.excalidraw", els, "ClipCast - DFD Level 0 (Context)")


# ── 09 DFD level 1 ───────────────────────────────────────────────────────────
def dfd1():
    els = []
    els += box(40, 300, 150, 60, "Creator", GRAY_BG, GRAY)
    procs = [
        (280, 80, "1.0 Auth\n(NextAuth + OTP)"),
        (280, 220, "2.0 Job intake\n(actions + gates)"),
        (280, 360, "3.0 Processing\n(Inngest + Modal)"),
        (280, 500, "4.0 Clip delivery\n(presigned S3)"),
        (280, 640, "5.0 Billing\n(Stripe + ledger)"),
        (280, 780, "6.0 Notifications\n(mail via Inngest)"),
        (280, 920, "7.0 Admin ops\n(audit logged)"),
    ]
    for x, y, label in procs:
        els += ellipse(x, y, 220, 90, label, SOFT, INDIGO, 13)
    stores = [
        (720, 100, "D1 User / Session"),
        (720, 240, "D2 UploadedFile (queue)"),
        (720, 380, "D3 Clip"),
        (720, 520, "D4 S3 media bucket"),
        (720, 660, "D5 Purchase + CreditTransaction"),
        (720, 800, "D6 LoginOtp"),
        (720, 940, "D7 AdminAuditLog"),
    ]
    for x, y, label in stores:
        els += [base("rectangle", x, y, 260, 46, strokeColor=GREEN, backgroundColor=GREEN_BG)]
        els += [text(x + 10, y + 12, label, size=13, color=GREEN, bold=True)]
    for i, (px, py, _) in enumerate(procs):
        els += arrow(190, 330, px, py + 45, color=GRAY)
        sx, sy, _ = stores[i]
        els += arrow(px + 220, py + 45, sx, sy + 23, color=INDIGO)
    els += arrow(390, 310, 390, 360, "queued job")
    els += arrow(390, 450, 390, 500, "rendered clips")
    els += arrow(390, 450, 500, 780, "job events -> emails", dashed=True)
    save("09-dfd-level1.excalidraw", els, "ClipCast - DFD Level 1")


usecase(); architecture(); flowchart(); activity(); sequence(); classes(); er(); dfd0(); dfd1()
print("done")
