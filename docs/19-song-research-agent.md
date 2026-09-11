# ClipCast 19: the Song Research (A&R) step

> **Status: BUILT (2026-07-19).** A step at the FRONT of the audio pipeline that
> researches a song before mixing it — identify it, pull its **real online
> lyrics**, find its **viral moment**, feed both to the crew, then produce.
> Downloader captures the heatmap/title (`_read_source_metadata`); the mixer runs
> `research.py` (`identify_song` / `fetch_lyrics` / `pick_viral_window`),
> feeds the real lyrics to the director and the viral window to the hook picker,
> and records `research …` in the processing summary. Fallback-first; CPU-tested
> in `apps/mixer/test_research.py`. Companion to
> [17](17-multi-agent-production-crew.md) (the crew) and
> [16](16-ai-arrangement-and-audio-rating.md) (the mixer).

## 1. Why
Today the mixer transcribes the vocal with Whisper — which mishears words — and
picks the hook by audio energy alone. Real, official lyrics + the section that
*actually went viral* make the AI director understand the song far better and
feature the right part. This is the "gather everything, understand deeply, then
produce" step the product wants.

## 2. What it produces (fed into the existing crew)
A `research` bundle attached to each source, consumed by the Lyricist/Director:
```
research = {
  song:        { artist, title, matched: bool },   # identity
  lyrics:      str,                                 # REAL lyrics (LRCLIB) …
  lyrics_source: "lrclib" | "lyrics.ovh" | "whisper",  # … or the Whisper fallback
  synced_lyrics: str | None,                        # LRC [mm:ss.xx] lines, if any
  viral_window: { start, end } | None,              # from the YouTube heatmap …
  viral_source: "heatmap" | "energy",               # … or energy hook detection
}
```

## 3. The three data sources (all free, chosen)
### a) Real lyrics — LRCLIB (free, no key)
- `GET https://lrclib.net/api/get?artist_name=<a>&track_name=<t>&duration=<sec>`
  → `{ id, trackName, artistName, plainLyrics, syncedLyrics, instrumental }`.
  `duration` (from the source) sharpens the match.
- Miss → `GET https://lrclib.net/api/search?q=<artist track>` → best match.
- Etiquette: send a descriptive `User-Agent` (LRCLIB asks for one); no key, no
  hard rate limit for light use.
- **Fallback → lyrics.ovh** `GET https://api.lyrics.ovh/v1/<artist>/<title>` →
  `{ lyrics }`. **Fallback → the current Whisper transcription** (never worse
  than today).
- Runs in the mixer via stdlib `urllib` — **no new image dependency** (same as
  the LLM providers in `llm_providers.py`).

### b) Viral moment — YouTube "most replayed" heatmap (free)
- yt-dlp's info dict already carries `heatmap`: a list of
  `{ start_time, end_time, value }` (value 0–1 = relative rewatch intensity).
  The **most-replayed window** is the run of segments with the highest value.
- The **downloader** (which already runs yt-dlp) captures `heatmap` + `title` +
  `uploader` and returns them alongside `duration`. Inngest passes them into the
  mixer request per source.
- **Fallback (your choice): keep the audio-energy `detect_hook`** when there's no
  heatmap (uploads, or videos without the data). So: heatmap when available,
  energy detection otherwise.

### c) Song identity
- Parse the source title: `"Artist - Title (Official Video)"` → strip the usual
  noise (`official video/audio/lyrics`, `[…]`, `(…)`, `feat.`) → `artist`,
  `title`. Fall back to the user's source label, then to the `uploader`.
- Good enough for LRCLIB lookups; audio-fingerprint ID (AcoustID) is a later
  upgrade for uploaded files with no title.

## 4. Where it slots into the pipeline
```
downloader (yt-dlp)  ──heatmap + title + uploader──▶  inngest
inngest  ──per-source {url, heatmap, title}──▶  mixer request
mixer._mashup:
  1. Demucs + BPM/key analysis            (unchanged)
  2. RESEARCH (new): identify song → LRCLIB lyrics (→lyrics.ovh→Whisper);
     viral_window from heatmap (→energy detect_hook)
  3. AI crew: Lyricist/Director read the REAL lyrics + viral_window → plan
  4. Hook selection biased to viral_window; ACE-Step bed; render; rate  (unchanged)
```
- New file `apps/mixer/research.py` (vendored/CPU-testable): `identify_song`,
  `fetch_lyrics`, `pick_viral_window(heatmap)`. Pure stdlib + `urllib`.
- The crew brief gains `lyrics` (real) + `song`; `state.analysis` gains
  `viral_window`. The Lyricist reads accurate words; the hook picker prefers the
  viral window.

## 5. Fallback-first (never breaks a render)
Every hop degrades: no title match → Whisper lyrics; LRCLIB miss → lyrics.ovh →
Whisper; no heatmap → energy hook. A mix always completes, just with less
research signal.

## 6. Observability
The `research` bundle is recorded in the crew ProductionLog + the
`processing_summary` (e.g. `lyrics: lrclib · viral: heatmap 41-58s`), so the
admin Production Room shows what was found and which source won.

## 7. Testing (CPU, no network)
`apps/mixer/test_research.py`: title parsing, `pick_viral_window` over a sample
heatmap, and lyrics fetch with a mocked `urllib` (LRCLIB hit, miss→fallback,
all-miss→Whisper). The crew's mock-LLM tests already cover the downstream plan.

## 8. Build phases (all complete ✅)
1. **Downloader** — capture + return `heatmap` + `title` + `uploader`. ✅
2. **research.py** — song-ID parse + LRCLIB/lyrics.ovh fetch + viral-window
   picker, all fallback-safe + CPU-tested (`apps/mixer/test_research.py`). ✅
3. **Wire-in** — inngest threads heatmap/title per source; mixer runs research,
   feeds real lyrics to the crew brief and viral_window to hook selection. ✅
4. **Observability** — surfaced in the processing summary + ProductionLog. ✅

## 9. Risks / notes
- Lyrics-site catalogs miss remixes/covers/regional tracks → Whisper fallback
  matters. Copyright: lyrics are fetched for the AI's *understanding*, not
  displayed/redistributed.
- Heatmap only exists for videos with enough views; uploads never have it →
  energy detection carries those.
- Title parsing is heuristic; a wrong match just means Whisper lyrics (no harm).
