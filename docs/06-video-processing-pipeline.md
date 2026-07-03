# 06 — Video processing pipeline (Modal)

Two independently deployed Modal apps. Full detail lives next to the code —
this page is the map between them.

- **[`clipcast-backend/apps/downloader/README.md`](../clipcast-backend/apps/downloader/README.md)**
  — CPU app. Takes a YouTube URL, downloads it through rotating free proxies
  (YouTube blocks datacenter IPs), uploads the source to S3. A scheduled Modal
  function refreshes the proxy ranking every 15 minutes in the background —
  never in the request path.
- **[`clipcast-backend/apps/processor/README.md`](../clipcast-backend/apps/processor/README.md)**
  — GPU (L40S) app. Downloads the S3 source, transcribes with WhisperX, asks
  Gemini which moments to clip, reframes to 9:16 following the active speaker
  (TalkNet), burns in captions, uploads clips to S3.

## Why they're split

Downloading is network-bound and needs YouTube-specific workarounds; the GPU
container should only ever spin up once a source file already exists in S3, so
it never burns expensive GPU-seconds waiting on a network call. Splitting also
lets the two scale independently — many concurrent downloads, a small number
of concurrent GPU renders (`max_containers=2` on the processor).

## Neither app touches the database

Both are pure "in bytes, out bytes" HTTP endpoints, authenticated with a shared
bearer token (`PROCESS_VIDEO_ENDPOINT_AUTH`). Job status, `Clip` rows, and
credit deduction are entirely the frontend's responsibility, done in
`processVideoFn` once these endpoints return (see
[05-uploads-and-queue.md](05-uploads-and-queue.md)). This keeps Modal
stateless and makes the frontend the single source of truth for "what happened
to this job."

## Local development never runs this

There is no local video processing path at all — `start.sh` only starts
Next.js, the Inngest dev worker, and (optionally) the Stripe webhook listener.
Every video-processing test hits the real deployed Modal endpoints, even in
development (`clipcast-backend/scripts/test_pipeline.py` runs an end-to-end
smoke test against them — see the backend README's "End-to-end pipeline test"
section).

## How to build the processor from scratch (Modal + FastAPI)

**Step 1 — install and authenticate Modal.**

```bash
pip install modal fastapi whisperx faster-whisper google-genai boto3
modal token new
```

**Step 2 — the class that keeps models warm** (`apps/processor/main.py`).
Modal's `@app.cls` + `@modal.enter()` is what makes GPU model loading a
one-time cost per container instead of a per-request cost:

```python
@app.cls(
    gpu="L40S", cpu=4.0, memory=16384, timeout=3600,
    retries=0,           # a partially-rendered clip should never be silently retried
    max_containers=2,
    scaledown_window=120,
    secrets=[modal.Secret.from_name("clipcast-secret")],
    volumes={mount_path: volume, hf_cache_path: hf_volume},
)
class ClipCast:
    @modal.enter()
    def load_model(self):
        import torch, whisperx
        if not torch.cuda.is_available():
            raise RuntimeError("Modal allocated a GPU but CUDA is unavailable")
        torch.backends.cuda.matmul.allow_tf32 = True
        self.whisperx_model = whisperx.load_model("large-v2", device="cuda", compute_type="float16")
        self.alignment_model, self.metadata = whisperx.load_align_model(language_code="en", device="cuda")
        volume.commit(); hf_volume.commit()   # persist first-start model downloads
        self.gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
```

**Step 3 — transcription** (`@modal.method`, called from the endpoint below):

```python
    @modal.method()
    def transcribe_video(self, base_dir, video_path):
        import torch, whisperx
        audio_path = base_dir / "audio.wav"
        subprocess.run(f"ffmpeg -i {video_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}",
                        shell=True, check=True, capture_output=True)
        audio = whisperx.load_audio(str(audio_path))
        with torch.inference_mode():
            result = self.whisperx_model.transcribe(audio, batch_size=16)
            result = whisperx.align(result["segments"], self.alignment_model, self.metadata, audio, device="cuda")
        segments = [{"start": ws["start"], "end": ws["end"], "word": ws.get("word", "")}
                    for ws in result.get("word_segments", []) if "start" in ws and "end" in ws]
        return json.dumps(segments)
```

**Step 4 — moment selection.** One prompt per clip mode (write your own
rules per mode — this is the actual `qa` prompt, trimmed):

```python
CLIP_MODE_PROMPTS = {
    "qa": """This is a podcast video transcript. Find questions and their answers.
Each clip must start with the question and end with the answer.
Rules:
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Output only JSON: [{"start": seconds, "end": seconds}, ...].
- Target 40-60 second clips. ~1 clip per 5 minutes of source.
- If no valid clips exist output [].
""",
    # "educational": ..., "motivational": ..., "highlights": ..., "all": ...
}

    @modal.method()
    def identify_moments(self, transcript, clip_mode="qa"):
        prompt = CLIP_MODE_PROMPTS.get(clip_mode, CLIP_MODE_PROMPTS["qa"])
        response = self.gemini_client.models.generate_content(
            model="gemini-2.5-flash", contents=prompt + str(transcript))
        # strip ```json fences, repair truncated JSON, json.loads() -> list or []
        return json.dumps(_clean_and_validate(response.text) or [])
```

**Step 5 — the public endpoint** ties it together — download from S3,
transcribe, pick moments, render each one (fast preview crop or full
ASD-tracked render + burned captions), upload clips, return:

```python
    @modal.fastapi_endpoint(method="POST")
    def process_video(self, request: ProcessVideoRequest,
                       token: HTTPAuthorizationCredentials = Depends(auth_scheme),
                       base_dir: pathlib.Path = Depends(temporary_workdir)):
        if token.credentials != os.environ["PROCESS_VIDEO_ENDPOINT_AUTH"]:
            raise HTTPException(status_code=401, detail="Incorrect bearer token")

        video_path = base_dir / "input.mp4"
        boto3.client("s3").download_file(os.environ["S3_BUCKET_NAME"], request.s3_key, str(video_path))

        transcript_json = self.transcribe_video.local(base_dir, video_path)
        moments = json.loads(self.identify_moments.local(transcript_json, request.clip_mode))

        clip_keys = []
        for i, m in enumerate(moments):
            if request.preview_only:
                clip_keys.append(create_preview_clip(base_dir, video_path, request.s3_key, m["start"], m["end"], i))
            else:
                clip_keys.append(process_clip(base_dir, video_path, request.s3_key, m["start"], m["end"], i, transcript_json))
        return {"clips": clip_keys}
```

`process_clip()` is where TalkNet active-speaker detection
(`asd/demoTalkNet.py`), `create_vertical_video()` (9:16 crop following the
speaker), and `create_subtitles_with_ffmpeg()` (burned captions) get chained
together — see [`clipcast-backend/apps/processor/README.md`](../clipcast-backend/apps/processor/README.md)
for that internal chain in more detail.

**Step 6 — the downloader**, in short (full detail + gotchas in
[`clipcast-backend/apps/downloader/README.md`](../clipcast-backend/apps/downloader/README.md)):

```python
@app.function(schedule=modal.Period(minutes=15))
def refresh_proxies() -> None:
    # runs yt-dlp-proxy's speed test (10-20 min) — NEVER call this from the
    # request path, only from this scheduled function
    ranked = _speed_test_free_proxies()
    volume_write_json("proxy.json", ranked[:5])

@app.function()
def download_youtube_video_worker(youtube_url: str, s3_key: str):
    for proxy in _load_free_proxies():
        try:
            _run_yt_dlp(youtube_url, output_template, _proxy_string(proxy), timeout=...)
            break  # first proxy that produces a finished file wins
        except ProxyFailure:
            continue  # burn this proxy, try the next ranked one
    boto3.client("s3").upload_file(str(downloaded_file), bucket, s3_key)
```

## Diagrams

- [`excalidraw/03-video-processing.excalidraw`](excalidraw/03-video-processing.excalidraw)
  — inside the GPU processor: model loading, transcription, Gemini moment
  selection, the preview/full branch, ASD → reframe → captions.
- [`excalidraw/04-youtube-ingestion.excalidraw`](excalidraw/04-youtube-ingestion.excalidraw)
  — the downloader's proxy rotation, plus the separate channel-connect OAuth
  flow.

## Next

[07-billing-and-credits.md](07-billing-and-credits.md) — how the user pays for
all this.
