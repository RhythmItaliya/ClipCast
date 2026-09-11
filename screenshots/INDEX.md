# ClipCast — full-system screenshots

Captured 2026-09-12 via `testing/capture_all.py` (real app, real browser).
25 shots across 3 sections. Every route, subpage, and interactive "open" state
(sidebar is in every shot; plus tab switches, the login OTP modal, the Library
expanded group + Production Room, the Audio Studio tabs, and the admin
user/job detail pages).

## Public (logged out)

- `01-public/01_landing.png` — Marketing landing page
- `01-public/02_signup.png` — Sign-up (email + OAuth)
- `01-public/03_login.png` — Login (password + OAuth)
- `01-public/04_login_otp_modal.png` — Login — 'sign in with a code' OTP modal (open)

## Client app (dashboard, Audio Studio, Library, Production Room)

- `02-app/01_dashboard_upload_tab.png` — Dashboard — Uploader (Upload File tab) + clip-mode chips
- `02-app/02_dashboard_youtube_tab.png` — Dashboard — Uploader switched to the YouTube URL tab
- `02-app/03_queue.png` — Processing queue (job status)
- `02-app/04_library.png` — Library — sources collapsed
- `02-app/05_library_expanded.png` — Library — a source expanded to its clip grid
- `02-app/06_production_room.png` — Production Room — the AI crew's decision trail for a source
- `02-app/07_audio_studio_mix.png` — Audio Studio — AI Mix (YouTube × YouTube mashup) tab
- `02-app/08_audio_studio_compose.png` — Audio Studio — Compose (text-to-music) tab
- `02-app/09_youtube_connect.png` — YouTube — connect channel / posting
- `02-app/10_billing.png` — Billing — credit packs + history
- `02-app/11_settings.png` — Account settings

## Admin panel

- `03-admin/01_overview.png` — Admin — platform overview (all accounts)
- `03-admin/02_users.png` — Admin — every account (credits, roles, jobs)
- `03-admin/03_user_detail.png` — Admin — a single user's detail + actions
- `03-admin/04_jobs.png` — Admin — all jobs across accounts
- `03-admin/05_job_detail.png` — Admin — a single job (model vs fallback, errors)
- `03-admin/06_clips.png` — Admin — all rendered clips
- `03-admin/07_billing.png` — Admin — revenue / purchases
- `03-admin/08_audit.png` — Admin — audit log
- `03-admin/09_health.png` — Admin — service / provider health
- `03-admin/10_providers.png` — Admin — AI providers (keys + active LLM)
