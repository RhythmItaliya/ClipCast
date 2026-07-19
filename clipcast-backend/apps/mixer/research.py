"""Song Research (A&R) — docs/19. Before a mix, learn the song: identify it,
fetch its REAL lyrics (LRCLIB, free; lyrics.ovh fallback), and find its viral
moment from the YouTube most-replayed heatmap. Pure stdlib (urllib) so it needs
no image dependency and unit-tests on CPU. Every step is best-effort — on any
miss the caller keeps the Whisper transcription / energy-based hook detection.
"""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

_UA = "ClipCast/1.0 (+https://clipcast.app; song-research)"

# Strip the usual YouTube-title noise so "Artist - Title (Official Video)" →
# "Artist - Title".
_NOISE = re.compile(
    r"\((?:official|lyrics?|audio|video|hd|4k|mv|music\s*video|visuali[sz]er|"
    r"lyric\s*video)[^)]*\)|\[[^\]]*\]|\bofficial\b|\blyrics?\b|\(feat[^)]*\)|"
    r"\bft\.[^-]*",
    re.IGNORECASE,
)


def identify_song(title: str | None, label: str = "") -> dict:
    """Best-effort {artist, title, matched} from a YouTube title or user label."""
    raw = (title or label or "").strip()
    if not raw:
        return {"artist": "", "title": "", "matched": False}
    cleaned = _NOISE.sub("", raw).strip(" -–—|")
    artist, track = "", cleaned
    for sep in (" - ", " – ", " — ", " -", "- "):
        if sep in cleaned:
            left, right = cleaned.split(sep, 1)
            artist, track = left.strip(), right.strip()
            break
    return {"artist": artist, "title": track, "matched": bool(track)}


def _http_json(url: str, timeout: int = 12):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def fetch_lyrics(artist: str, title: str, duration: float = 0) -> tuple[str, str | None, str]:
    """(plain_lyrics, synced_lyrics|None, source). source is "lrclib" |
    "lyrics.ovh" | "" (not found)."""
    if not title:
        return "", None, ""
    # 1. LRCLIB exact get (duration sharpens the match).
    try:
        params = {"artist_name": artist, "track_name": title}
        if duration:
            params["duration"] = str(int(duration))
        data = _http_json(f"https://lrclib.net/api/get?{urllib.parse.urlencode(params)}")
        if isinstance(data, dict) and (data.get("plainLyrics") or data.get("syncedLyrics")):
            return (data.get("plainLyrics") or "").strip(), data.get("syncedLyrics"), "lrclib"
    except Exception as e:  # noqa: BLE001
        print(f"[research] lrclib get failed: {e}")
    # 2. LRCLIB search.
    try:
        q = urllib.parse.urlencode({"q": f"{artist} {title}".strip()})
        results = _http_json(f"https://lrclib.net/api/search?{q}")
        if isinstance(results, list) and results:
            best = results[0]
            if best.get("plainLyrics") or best.get("syncedLyrics"):
                return (best.get("plainLyrics") or "").strip(), best.get("syncedLyrics"), "lrclib"
    except Exception as e:  # noqa: BLE001
        print(f"[research] lrclib search failed: {e}")
    # 3. lyrics.ovh fallback.
    try:
        url = (
            "https://api.lyrics.ovh/v1/"
            f"{urllib.parse.quote(artist)}/{urllib.parse.quote(title)}"
        )
        data = _http_json(url)
        if isinstance(data, dict) and data.get("lyrics"):
            return data["lyrics"].strip(), None, "lyrics.ovh"
    except Exception as e:  # noqa: BLE001
        print(f"[research] lyrics.ovh failed: {e}")
    return "", None, ""


def pick_viral_window(
    heatmap, window_sec: float, clip_end: float | None = None
) -> dict | None:
    """The most-replayed ~window_sec window as {start, end}, from yt-dlp's
    heatmap ([{start_time, end_time, value}]), or None."""
    if not heatmap or window_sec <= 0:
        return None
    segs = [
        s for s in heatmap
        if isinstance(s, dict) and "start_time" in s and "value" in s
    ]
    if not segs:
        return None
    best = max(segs, key=lambda s: float(s.get("value", 0) or 0))
    center = (float(best["start_time"]) + float(best.get("end_time", best["start_time"]))) / 2.0
    start = max(0.0, center - window_sec / 2.0)
    end = start + window_sec
    if clip_end and end > clip_end:
        end = float(clip_end)
        start = max(0.0, end - window_sec)
    return {"start": round(start, 2), "end": round(end, 2)}


def research_source(
    meta: dict | None,
    whisper_lyrics: str = "",
    window_sec: float = 0,
    clip_end: float | None = None,
) -> dict:
    """Assemble the research bundle for one source (docs/19 §2). `meta` carries
    {title, uploader, heatmap, duration, label} from the downloader."""
    meta = meta or {}
    song = identify_song(meta.get("title"), meta.get("label", ""))
    lyrics, synced, source = fetch_lyrics(
        song["artist"], song["title"], meta.get("duration") or 0
    )
    if not lyrics:  # fall back to the Whisper transcription
        lyrics, synced, source = (whisper_lyrics or ""), None, ("whisper" if whisper_lyrics else "")
    viral = pick_viral_window(meta.get("heatmap"), window_sec, clip_end)
    return {
        "song": song,
        "lyrics": lyrics[:4000],
        "lyrics_source": source,
        "synced_lyrics": synced,
        "viral_window": viral,
        "viral_source": "heatmap" if viral else "energy",
    }
