# ClipCast diagrams

All Excalidraw files live here. Open any of them at [excalidraw.com](https://excalidraw.com) → menu → **Open** → pick the file (or drag it in).

| File | What it shows |
|---|---|
| [`00-system-design-end-to-end.excalidraw`](00-system-design-end-to-end.excalidraw) | The whole system on one canvas: actors, frontend, queue, external services, backend, database — numbered end-to-end request flow. Start here. |
| [`01-pipeline-overview.excalidraw`](01-pipeline-overview.excalidraw) | One job, traced hop by hop: submit → usage gates → queue → (YouTube download or direct upload) → GPU processor → write results → user sees clips. |
| [`02-credits-and-billing.excalidraw`](02-credits-and-billing.excalidraw) | The credit lifecycle: signup grant, pre-submit gate, up-front estimate vs. true-up, deduction — plus the Stripe checkout → webhook → `Purchase` ledger loop and why it's idempotent. |
| [`03-video-processing.excalidraw`](03-video-processing.excalidraw) | Inside the GPU processor Modal app: model loading, transcription, Gemini moment selection, the preview-vs-full branch, and the ASD → reframe → caption render chain. |
| [`04-youtube-ingestion.excalidraw`](04-youtube-ingestion.excalidraw) | Two separate YouTube integrations: Lane A (paste a URL → proxy-rotated download → S3) and Lane B (OAuth channel-connect → token refresh → channel video list), including the daily auto-clip cron's current stub status. |
| [`clipcast-system-design-original.excalidraw`](clipcast-system-design-original.excalidraw) | Earlier system-design diagram, kept as-is for reference — predates the `Purchase`/`AdminAuditLog` models and the admin billing/audit-log pages. Superseded by `00-system-design-end-to-end.excalidraw` for current state. |
| [`architecture-reference.excalidraw`](architecture-reference.excalidraw) | Earlier architecture sketch, kept as-is for reference. |

The `00`–`04` files are generated (not hand-drawn) so they stay easy to
regenerate as the system changes — see the `docs/*.md` build guide, whose
numbered stages these diagrams mirror one-to-one.
