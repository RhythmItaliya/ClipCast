# ClipCast 06: Video processing pipeline (Modal)

Two independently deployed Modal apps. Full detail lives next to the code;
this page is the map between them.

- **[`clipcast-backend/apps/downloader/README.md`](../clipcast-backend/apps/downloader/README.md)**:
  CPU app. Takes a YouTube URL, downloads it through rotating free proxies
  (YouTube blocks datacenter IPs), uploads the source to S3. A scheduled Modal
  function refreshes the proxy ranking every 15 minutes in the background,
  never in the request path.
- **[`clipcast-backend/apps/processor/README.md`](../clipcast-backend/apps/processor/README.md)**:
  GPU (L40S) app. Downloads the S3 source, transcribes with WhisperX, asks
  Gemini which moments to clip, reframes to 9:16 following the active speaker
  (TalkNet), burns in captions, uploads clips to S3.

## Why they're split

Downloading is network-bound and needs YouTube-specific workarounds; the GPU
container should only ever spin up once a source file already exists in S3, so
it never burns expensive GPU-seconds waiting on a network call. Splitting also
lets the two scale independently: many concurrent downloads, a small number
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

There is no local video processing path at all. `start.sh` only starts
Next.js, the Inngest dev worker, and (optionally) the Stripe webhook listener.
Every video-processing test hits the real deployed Modal endpoints, even in
development (`clipcast-backend/scripts/test_pipeline.py` runs an end-to-end
smoke test against them; see the backend README's "End-to-end pipeline test"
section).

## How to build the processor from scratch (Modal + FastAPI)

**Step 1: install and authenticate Modal.**

```bash
pip install modal fastapi whisperx faster-whisper google-genai boto3
modal token new
```

**Step 2: the class that keeps models warm** (`apps/processor/main.py`).
Modal's `@app.cls` + `@modal.enter()` is what makes GPU model loading a
one-time cost per container instead of a per-request cost:

```python
@app.cls(
    gpu="L40S", cpu=4.0, memory=16384, timeout=14400,  # 4h, long podcasts need real headroom
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

**Step 3: transcription** (`@modal.method`, called from the endpoint below):

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

**Step 4: moment selection, plus an AI title.** One prompt per clip mode
(write your own rules per mode; this is the actual `qa` prompt, trimmed).
The prompt asks Gemini for a `title` alongside each `{start, end}`, free,
since it's the same call that already picks the moments, no second API call
needed:

```python
CLIP_MODE_PROMPTS = {
    "qa": """This is a podcast video transcript. Find questions and their answers.
Each clip must start with the question and end with the answer.
Rules:
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Include a short, punchy, clickable title for each clip (max 60 characters,
  no surrounding quotes) in a "title" field. This is shown to viewers, so
  make it a hook, not a description.
- Output only JSON: [{"start": seconds, "end": seconds, "title": "..."}, ...].
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

**Step 5: the public endpoint** ties it together: download from S3,
transcribe, pick moments, render each one (fast preview crop or full
ASD-tracked render + burned captions + thumbnail), upload clips, and return a
**structured per-clip list** (not just aggregate counts; this is what the
frontend uses to create `Clip` rows directly, instead of guessing at rendered
filenames by listing the S3 bucket):

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

        clip_records = []
        for i, m in enumerate(moments):
            if request.preview_only:
                record = create_preview_clip(base_dir, video_path, request.s3_key, m["start"], m["end"], i, m["title"])
            else:
                record = process_clip(base_dir, video_path, request.s3_key, m["start"], m["end"], i, transcript_json, m["title"])
            clip_records.append(record)  # {s3_key, thumbnail_s3_key, title, duration}
        return {"success": True, "duration": duration, "clips": clip_records}
```

`process_clip()` is where TalkNet active-speaker detection
(`asd/demoTalkNet.py`), `create_vertical_video()` (9:16 crop following the
speaker), `create_subtitles_with_ffmpeg()` (burned karaoke captions + subtle
watermark, see below), and `create_thumbnail()` get chained together; see
[`clipcast-backend/apps/processor/README.md`](../clipcast-backend/apps/processor/README.md)
for that internal chain in more detail. Each render function returns
`{"s3_key": ..., "thumbnail_s3_key": ..., "title": ..., "duration": ...}`,
which is exactly the shape the frontend's `create-clips-in-db` step maps
straight into `db.clip.createMany()` (see
[05-uploads-and-queue.md](05-uploads-and-queue.md)).

## Captions: karaoke word-highlight, no black box

`create_subtitles_with_ffmpeg()` builds one ASS subtitle event **per word**
(not per multi-word chunk); each event spans exactly that word's spoken
duration, with the chunk's text rendered plain white except the
currently-active word, which is wrapped in a color override tag:

```python
def rgb_to_ass_bgr(r, g, b):
    return f"{b:02X}{g:02X}{r:02X}"   # ASS colors are BGR, not RGB

HIGHLIGHT_COLOR_BGR = rgb_to_ass_bgr(99, 102, 241)  # ClipCast brand indigo (#6366F1)

for chunk in chunks:               # chunk = list of (word, start_rel, end_rel)
    words = [w for w, _, _ in chunk]
    for i, (word, start_rel, end_rel) in enumerate(chunk):
        styled = [f"{{\\c&H{HIGHLIGHT_COLOR_BGR}&}}{w}{{\\c&HFFFFFF&}}" if j == i else w
                  for j, w in enumerate(words)]
        subs.events.append(pysubs2.SSAEvent(
            start=pysubs2.make_time(s=start_rel), end=pysubs2.make_time(s=end_rel),
            text=' '.join(styled), style="Default"))
```

The style itself has **no drop shadow** (`shadow = 0.0`). A heavy black
shadow/box behind captions reads as amateur. A thicker outline
(`outline = 3.0`, black) replaces it for readability over busy footage
without the black cast.

## Watermark: subtle, semi-transparent, not a bold label

The same `WATERMARK_DRAWTEXT` constant is shared by the full-quality caption
render and the fast preview path:

```python
WATERMARK_DRAWTEXT = (
    "drawtext=text='ClipCast':fontfile=/usr/share/fonts/truetype/custom/Anton-Regular.ttf:"
    "x=w-tw-36:y=36:fontsize=42:fontcolor=white@0.55:"
    "shadowcolor=black@0.35:shadowx=1:shadowy=1"
)
```

Small, ~55% opacity, thin shadow, sized like a real Reels/TikTok creator
watermark rather than a solid, attention-grabbing label. There's no separate
logo image asset (none exists in the repo); this is a deliberate,
maintenance-free choice: one ffmpeg `drawtext` filter, no binary asset to
keep in sync with the brand.

## Thumbnails

`create_thumbnail()` grabs a single frame via ffmpeg (`-vframes 1`) from the
**final** rendered output (after captions/watermark, so the preview matches
what viewers will actually see) at roughly 15% into the clip, early enough to
be representative, late enough to avoid a black/blank opening frame:

```python
def create_thumbnail(video_path, output_path, at_seconds):
    subprocess.run(f"ffmpeg -y -ss {max(0.0, at_seconds)} -i {video_path} -vframes 1 -q:v 3 {output_path}",
                    shell=True, check=True, capture_output=True)
```

Uploaded to S3 as `{clip_name}_thumb.jpg` next to the clip itself. The
frontend batch-presigns these (`getClipThumbnailUrls()` in
`src/actions/clips.ts`) rather than making the bucket public.

**Step 6: the downloader**, in short (full detail + gotchas in
[`clipcast-backend/apps/downloader/README.md`](../clipcast-backend/apps/downloader/README.md)):

```python
@app.function(schedule=modal.Period(minutes=15))
def refresh_proxies() -> None:
    # runs yt-dlp-proxy's speed test (10-20 min); NEVER call this from the
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
  the GPU processor's model loading, transcription, Gemini moment
  selection, the preview/full branch, ASD → reframe → captions.
- [`excalidraw/04-youtube-ingestion.excalidraw`](excalidraw/04-youtube-ingestion.excalidraw)
  the downloader's proxy rotation, plus the separate channel-connect OAuth
  flow.

## Next

[07-billing-and-credits.md](07-billing-and-credits.md): how the user pays for
all this.
