# ClipCast 18: agent monitoring, compute & hosting (all free)

How to *watch* the production crew work (docs/17), and where every heavy task
runs so **almost nothing runs on your PC** and the whole thing stays on free
tiers.

## 1. Two ways to watch the crew

### a) Production Room — built in, always on, zero setup
Every job stores its crew transcript (`UploadedFile.productionLog`) and renders
it at **`/dashboard/production/[id]`** — the round-by-round decisions, role
handoffs, rationales, and the Colorist's live RGB swatch. Nothing to install;
it's part of the app.

### b) Langfuse — the free open-source agent-monitoring dashboard
[Langfuse](https://langfuse.com) (MIT) gives a real observability dashboard:
per-agent inputs/outputs, latency, token cost, **errors**, and full traces of
each crew run. The mixer + processor emit traces to it automatically
(`crew/monitoring.py`).

**Use the free cloud tier — nothing runs on your PC (recommended):**
1. Sign up at **cloud.langfuse.com** (free Hobby tier), create a project.
2. Copy its **Public** + **Secret** keys.
3. Add them to the Modal secret the apps already use (`clipcast-secret`):
   `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and
   `LANGFUSE_HOST=https://cloud.langfuse.com`.
4. Redeploy the mixer/processor. Traces show up live in the Langfuse UI.

**If you'd rather self-host** (only if you *want* it on your machine):
`docker compose -f clipcast-backend/docker-compose.langfuse.yml up -d` →
`http://localhost:3001`, then use its keys with
`LANGFUSE_HOST=http://<your-host>:3001`.

**Optional by design:** with no `LANGFUSE_*` keys set, the tracer is a no-op —
the crew runs exactly the same, just without the external dashboard. It can
never break a render (every trace call is wrapped).

## 2. Where compute runs — your PC stays light

| Task | Runs on | Your PC? |
|------|---------|----------|
| YouTube/audio download | Modal (`clipcast-downloader`, CPU) | no |
| Clip pipeline (WhisperX, TalkNet, ffmpeg) | Modal (`clipcast`, L40S GPU) | no |
| Audio mixer (Demucs, Whisper, FX, master) | Modal (`clipcast-mixer`, L40S GPU) | no |
| Neural bed (ACE-Step) | Modal (`clipcast-composer`, L4 GPU) | no |
| Agent LLM calls (DeepSeek / Gemini / Claude) | the provider's API | no |
| Agent monitoring (Langfuse) | Langfuse Cloud (free) | no |
| Next.js app + `db push` + CPU crew tests | **your PC** | yes (light) |

So the only things on your machine are the web dev server and small,
dependency-free Python tests. No model ever downloads or runs locally — that's
why the mixer README says "nothing new installs on your machine."

## 3. Modal setup — the process, and why it's the best free fit

- **Serverless + scale-to-zero:** each app spins a container **only while a job
  runs**, then shuts down. You're not paying for idle GPUs. Modal's free tier
  ($30/mo credits) comfortably covers light/personal use because jobs are short
  and there's no always-on server.
- **One app per task, on purpose:** downloader / processor / mixer / composer
  are **separate Modal apps with separate images**. This is the "unique Modal
  per task" model — a dependency bump in one (e.g. ACE-Step's transformers pin)
  can never break another, and each scales independently.
- **Models load once, stay warm:** each GPU app is an `@app.cls` with
  `@modal.enter()` that loads its models a single time per warm container and
  caches weights in a **Modal Volume**, so repeat jobs skip the download. This
  is how models are "loaded and hosted in the task" without touching your PC.
- **Deploy:** run each app's `deploy.sh` (they call `modal deploy`). The mixer
  calls the composer app by name (`modal.Cls.from_name`), so they cooperate
  without any server you manage.

### Free GPU alternatives (if you ever outgrow Modal's credits)
Modal is the best fit here because it's **serverless API hosting** — most free
GPU offers aren't:
- **HuggingFace Spaces (ZeroGPU)** — free GPU, but shaped for demos, not a
  low-latency job API.
- **Google Colab / Kaggle** — free GPUs for notebooks, **not** for hosting an
  endpoint (they time out; no stable URL).
- **RunPod / Lightning / Baseten** — good GPU serving, but not truly free.

Recommendation: **stay on Modal.** The serverless design already keeps cost near
zero for personal use; if a specific step gets heavy, tune its `gpu=` tier (e.g.
the composer runs on a cheap `L4`) rather than switching providers.
