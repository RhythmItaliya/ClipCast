import glob
import json
import math
import pathlib
import pickle
import shutil
import subprocess
import sys
import time
import uuid
import boto3
import cv2
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from captions import (
    CAPTION_FONT_PATH,
    build_caption_subs,
    parse_hex_color,
)
from clip_crew import plan_clip_presentation

try:
    import ffmpegcv
except (ImportError, RuntimeError):
    ffmpegcv = None

try:
    import whisperx
except Exception as e:
    print(f"Warning: whisperx import failed locally: {e}")
    whisperx = None

import modal
import numpy as np
from pydantic import BaseModel
import os
from google import genai
from google.genai import types as genai_types

from tqdm import tqdm


class ProcessVideoRequest(BaseModel):
    s3_key: str
    youtube_url: str | None = None
    clip_mode: str = "qa"
    preview_only: bool = False
    # "#RRGGBB" — the user's chosen active-word caption highlight color;
    # None falls back to the ClipCast brand indigo.
    caption_color: str | None = None
    # The user's own watermark text. None/empty means NO watermark at all —
    # nothing is hardcoded.
    watermark_text: str | None = None


CLIP_MODE_PROMPTS = {
    "qa": """\
This is a podcast video transcript. I need clips between 30-60 seconds long.
Find questions and their corresponding answers.
Each clip must start with the question and end with the answer.
A few context sentences before the question are fine.

Rules:
- Clips must not overlap.
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Only use timestamps from the input — do not modify them.
- Include a short, punchy, clickable title for each clip (max 60 characters, no
  surrounding quotes) in a "title" field — this is shown to viewers, so make it
  a hook, not a description.
- Output only JSON: [{"start": seconds, "end": seconds, "title": "..."}, ...]. Must be parseable by json.loads().
- Target 40-60 second clips.
- Density: Aim for approximately 1 high-quality clip for every 5 minutes of podcast duration (e.g., 4 clips for a 20-minute video).
- Exclude: greetings, thank-yous, farewells.
- If no valid clips exist output [].

Transcript:
""",
    "motivational": """\
This is a podcast video transcript. I need clips between 30-60 seconds long.
Find the most motivational and inspiring moments — personal stories of struggle and
comeback, hard-won lessons, mindset shifts, or calls to action that leave the viewer
fired up and encouraged. The clip should feel complete, with a clear build-up and an
uplifting or empowering payoff.

Rules:
- Clips must not overlap.
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Only use timestamps from the input — do not modify them.
- Include a short, punchy, clickable title for each clip (max 60 characters, no
  surrounding quotes) in a "title" field — this is shown to viewers, so make it
  a hook, not a description.
- Output only JSON: [{"start": seconds, "end": seconds, "title": "..."}, ...]. Must be parseable by json.loads().
- Target 40-60 second clips.
- Exclude: greetings, abstractions without a concrete point, or filler conversation.
- If no valid clips exist output [].

Transcript:
""",
    "educational": """\
This is a podcast video transcript. I need clips between 30-60 seconds long.
Find moments where a key insight, practical tip, framework, fact, or lesson is being
explained. The clip should feel like a standalone mini-lesson that teaches the viewer
something valuable and actionable.

Rules:
- Clips must not overlap.
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Only use timestamps from the input — do not modify them.
- Include a short, punchy, clickable title for each clip (max 60 characters, no
  surrounding quotes) in a "title" field — this is shown to viewers, so make it
  a hook, not a description.
- Output only JSON: [{"start": seconds, "end": seconds, "title": "..."}, ...]. Must be parseable by json.loads().
- Target 40-60 second clips.
- Exclude: greetings, opinions without supporting reasoning, or vague statements.
- If no valid clips exist output [].

Transcript:
""",
    "highlights": """\
This is a podcast video transcript. I need clips between 30-60 seconds long.
Find the most energetic, surprising, controversial, or viral-worthy moments — statements
that are bold, counterintuitive, or highly quotable. The clip should immediately grab
attention and make the viewer want to watch or share it.

Rules:
- Clips must not overlap.
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Only use timestamps from the input — do not modify them.
- Include a short, punchy, clickable title for each clip (max 60 characters, no
  surrounding quotes) in a "title" field — this is shown to viewers, so make it
  a hook, not a description.
- Output only JSON: [{"start": seconds, "end": seconds, "title": "..."}, ...]. Must be parseable by json.loads().
- Target 40-60 second clips.
- Exclude: greetings, slow warm-up conversation, or generic statements.
- If no valid clips exist output [].

Transcript:
""",
    "any": """\
This is a podcast video transcript. I need clips between 30-60 seconds long.
This podcast could be about anything — comedy, storytelling, interviews, debate,
tech, sports, true crime, relationships, business, anything at all. First
understand what KIND of content this episode actually is, then find its most
compelling, self-contained, clip-worthy moments of ANY type: funny exchanges,
sad or emotional stories, heated arguments, bold hot takes, surprising reveals,
great advice, wild anecdotes, vulnerable confessions — whatever this particular
episode genuinely contains. Do not force moments into predefined boxes; let the
content decide.

For each clip, invent a short, fresh 1-3 word category tag that genuinely
describes that specific moment (e.g. "Comedy", "Sad Story", "Hot Take",
"Wild Story", "Life Advice", "Debate", "Confession") — whatever fits, not a
fixed list.

Rules:
- Clips must not overlap.
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Only use timestamps from the input — do not modify them.
- Include a short, punchy, clickable title for each clip (max 60 characters, no
  surrounding quotes) in a "title" field — this is shown to viewers, so make it
  a hook, not a description.
- Include your invented category tag (1-3 words, Title Case, no surrounding
  quotes) in a "category" field.
- Output only JSON: [{"start": seconds, "end": seconds, "title": "...", "category": "..."}, ...].
  Must be parseable by json.loads().
- Target 40-60 second clips.
- Density: aim for roughly 1 high-quality clip per 5 minutes of podcast.
- Exclude: greetings, thank-yous, farewells, and filler conversation.
- If no valid clips exist output [].

Transcript:
""",
}

# Modes fanned out over when clip_mode == "all" — one full Gemini pass per
# mode per chunk, so "All" actually surfaces a genuine mix across every
# category instead of one blended call that empirically skews toward
# whichever pattern (usually Q&A) is most mechanically easy to spot. The
# "any" pass at the end is fully open-ended: the model decides what kinds
# of moments this particular podcast contains (comedy, sad story, debate,
# whatever) and tags each clip itself, so nothing that falls outside the
# four fixed categories gets missed.
ALL_FANOUT_MODES = ["qa", "educational", "motivational", "highlights", "any"]

# Display name for each fixed mode's own category label (the "any" mode is
# the only one where Gemini invents its own per clip — see the prompt above).
MODE_CATEGORY_LABELS = {
    "qa": "Q&A",
    "educational": "Educational",
    "motivational": "Motivational",
    "highlights": "Highlights",
}

# Hard floor on clip length. The prompts ask Gemini for 30-60s clips, but it
# occasionally returns a sliver (a few seconds) that makes a jarring micro-clip;
# identify_moments drops anything shorter than this, the single choke point for
# every mode.
MIN_CLIP_SECONDS = 15.0

# Auto-theme the active-word caption highlight by the clip's mood/category when
# the user hasn't picked their own color. Keyed first on the fixed mode labels,
# then on keywords for the AI-invented "any"-mode tags.
CATEGORY_HIGHLIGHT_HEX = {
    "q&a": "#38BDF8",          # sky — informative
    "educational": "#22C55E",  # green — learning
    "motivational": "#F59E0B", # amber — inspiring
    "highlights": "#EF4444",   # red — hype
}
_MOOD_KEYWORD_HEX = [
    (("sad", "emotional", "grief", "loss", "heartfelt", "reflect", "introspect"), "#6366F1"),
    (("funny", "comedy", "humor", "laugh", "joke"), "#F59E0B"),
    (("debate", "controvers", "argument", "hot take", "conflict"), "#EF4444"),
    (("inspir", "motivat", "uplift", "hope"), "#F97316"),
    (("story", "journey", "struggle"), "#A855F7"),
    (("tip", "lesson", "insight", "how", "learn", "fact"), "#22C55E"),
    (("energy", "hype", "wild", "crazy", "viral", "surpris"), "#EC4899"),
]


def _category_highlight_hex(category):
    """Mood-themed caption highlight hex for a clip's category, or None (→ brand
    default) when nothing matches."""
    if not category:
        return None
    c = category.strip().lower()
    if c in CATEGORY_HIGHLIGHT_HEX:
        return CATEGORY_HIGHLIGHT_HEX[c]
    for keywords, hex_color in _MOOD_KEYWORD_HEX:
        if any(k in c for k in keywords):
            return hex_color
    return None


def _rgb_to_hex(rgb):
    """[r, g, b] → '#RRGGBB'."""
    r, g, b = (max(0, min(255, int(v))) for v in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def _clip_transcript_snippet(transcript_segments, start, end, max_chars=400):
    """The words spoken inside a clip's window — context for the Colorist to
    read the clip's emotion from."""
    words = [
        s.get("word", "")
        for s in transcript_segments
        if s.get("start") is not None and s.get("end") is not None
        and s["end"] > start and s["start"] < end
    ]
    return " ".join(w for w in words if w).strip()[:max_chars]

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.11")
    .apt_install([
        "ffmpeg", "libgl1-mesa-glx", "wget",
        "libcudnn8", "libcudnn8-dev",
        "pkg-config", "libavformat-dev", "libavcodec-dev",
        "libavdevice-dev", "libavutil-dev", "libswscale-dev",
        "libswresample-dev", "libavfilter-dev",
        "clang", "build-essential", "gcc", "git",
    ])
    .run_commands([
        "apt-get install -y unzip",
        "echo 'bust-1747391000'",
    ])
    .run_commands(["pip install --upgrade pip setuptools==69.5.1 wheel"])
    .run_commands([
        "pip install torch==2.2.2 torchaudio==2.2.2 torchvision==0.17.2 "
        "--index-url https://download.pytorch.org/whl/cu121"
    ])
    .pip_install_from_requirements("requirements.txt")

    .run_commands([
        "pip install 'numpy==1.26.4'",
        "pip install --no-deps ctranslate2==4.4.0",
        "pip install faster-whisper==1.0.3 pyannote.audio==3.3.2 numpy==1.26.4 nltk",
        "git clone --branch v3.3.0 --depth 1 "
        "    https://github.com/m-bain/whisperx.git /tmp/whisperx",
        "sed -i 's/\"multilingual\": self.model.is_multilingual,//' "
        "    /tmp/whisperx/whisperx/asr.py",
        "pip install /tmp/whisperx --no-deps --no-build-isolation",
        "rm -rf /tmp/whisperx",
        "python -c 'import numpy; assert numpy.__version__.startswith(\"1.\"), f\"Wrong numpy: {numpy.__version__}\"'",
        "python -c 'import whisperx; print(\"✓ whisperx loaded successfully\")'",
    ])
    .run_commands([
        "mkdir -p /usr/share/fonts/truetype/custom",
        "wget -O /usr/share/fonts/truetype/custom/Poppins-Black.ttf "
        "    https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Black.ttf",
        "fc-cache -f -v",
    ])
    # Mount model volumes outside paths that image-build dependencies may
    # populate. Modal rejects Volume mounts over non-empty image directories.
    .env({
        "TORCH_HOME": "/model-cache/torch",
        "HF_HOME": "/model-cache/huggingface",
        "HUGGINGFACE_HUB_CACHE": "/model-cache/huggingface/hub",
        "TRANSFORMERS_CACHE": "/model-cache/huggingface/transformers",
    })
    .add_local_dir("asd", "/asd", copy=True)
    # Caption ASS generation lives in its own module so the render-test
    # harness (scripts/render_caption_test.py) can exercise the exact
    # production code on a cheap CPU container.
    .add_local_python_source("captions", "crew", "clip_crew")
)

app = modal.App("clipcast", image=image)

volume = modal.Volume.from_name(
    "clipcast-model-cache", create_if_missing=True
)
hf_volume = modal.Volume.from_name(
    "clipcast-huggingface-cache", create_if_missing=True
)

mount_path = "/model-cache/torch"
hf_cache_path = "/model-cache/huggingface"

auth_scheme = HTTPBearer()


def temporary_workdir():
    """Create request-scoped scratch space and always remove it."""
    run_id = str(uuid.uuid4())
    base_dir = pathlib.Path("/tmp") / run_id
    base_dir.mkdir(parents=True, exist_ok=True)
    try:
        yield base_dir
    finally:
        shutil.rmtree(base_dir, ignore_errors=True)
        print(f"Cleaned up temp dir: {base_dir}")


def create_vertical_video(tracks, scores, pyframes_path, pyavi_path, audio_path, output_path, framerate=25):
    target_width = 1080
    target_height = 1920

    flist = glob.glob(os.path.join(pyframes_path, "*.jpg"))
    flist.sort()

    faces = [[] for _ in range(len(flist))]

    for tidx, track in enumerate(tracks):
        score_array = scores[tidx]
        for fidx, frame in enumerate(track["track"]["frame"].tolist()):
            slice_start = max(fidx - 30, 0)
            slice_end = min(fidx + 30, len(score_array))
            score_slice = score_array[slice_start:slice_end]
            avg_score = float(np.mean(score_slice) if len(score_slice) > 0 else 0)
            faces[frame].append({
                'track': tidx, 'score': avg_score,
                's': track['proc_track']["s"][fidx],
                'x': track['proc_track']["x"][fidx],
                'y': track['proc_track']["y"][fidx]
            })

    temp_video_path = os.path.join(pyavi_path, "video_only.mp4")
    vout = None

    for fidx, fname in tqdm(enumerate(flist), total=len(flist), desc="Creating vertical video"):
        img = cv2.imread(fname)
        if img is None:
            continue

        current_faces = faces[fidx]
        max_score_face = max(current_faces, key=lambda face: face['score']) if current_faces else None
        if max_score_face and max_score_face['score'] < 0:
            max_score_face = None

        if vout is None:
            vout = ffmpegcv.VideoWriterNV(
                file=temp_video_path, codec=None,
                fps=framerate, resize=(target_width, target_height)
            )

        if max_score_face:
            scale = target_height / img.shape[0]
            resized_image = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            frame_width = resized_image.shape[1]
            center_x = int(max_score_face["x"] * scale)
            top_x = max(min(center_x - target_width // 2, frame_width - target_width), 0)
            image_cropped = resized_image[0:target_height, top_x:top_x + target_width]
            vout.write(image_cropped)
        else:
            scale = target_width / img.shape[1]
            resized_height = int(img.shape[0] * scale)
            resized_image = cv2.resize(img, (target_width, resized_height), interpolation=cv2.INTER_AREA)
            scale_for_bg = max(target_width / img.shape[1], target_height / img.shape[0])
            bg_width = int(img.shape[1] * scale_for_bg)
            bg_height = int(img.shape[0] * scale_for_bg)
            blurred_background = cv2.resize(img, (bg_width, bg_height))
            blurred_background = cv2.GaussianBlur(blurred_background, (121, 121), 0)
            crop_x = (bg_width - target_width) // 2
            crop_y = (bg_height - target_height) // 2
            blurred_background = blurred_background[crop_y:crop_y + target_height, crop_x:crop_x + target_width]
            center_y = (target_height - resized_height) // 2
            blurred_background[center_y:center_y + resized_height, :] = resized_image
            vout.write(blurred_background)

    if vout:
        vout.release()

    ffmpeg_command = (
        f"ffmpeg -y -i {temp_video_path} -i {audio_path} "
        f"-c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart {output_path}"
    )
    subprocess.run(ffmpeg_command, shell=True, check=True, text=True)


def watermark_filter(watermark_text):
    """Optional subtle corner watermark — the user's OWN text, low-opacity
    white, sized and faded like a real Reels/TikTok creator watermark.
    Returns None when the user hasn't set one: no watermark is burned at
    all (nothing is hardcoded).
    """
    text = (watermark_text or "").strip()[:40]
    if not text:
        return None
    # ffmpeg drawtext text needs \ , ' , : and % escaped.
    escaped = (
        text.replace("\\", "\\\\")
        .replace("'", "’")  # drawtext can't nest quotes; use a typographic one
        .replace(":", "\\:")
        .replace("%", "\\%")
    )
    return (
        f"drawtext=text='{escaped}':"
        f"fontfile={CAPTION_FONT_PATH}:"
        "x=w-tw-36:y=36:fontsize=42:fontcolor=white@0.55:"
        "shadowcolor=black@0.35:shadowx=1:shadowy=1"
    )


def create_thumbnail(video_path, output_path, at_seconds):
    """Grab a single frame as a JPEG preview thumbnail."""
    subprocess.run(
        f"ffmpeg -y -ss {max(0.0, at_seconds)} -i {video_path} -vframes 1 -q:v 3 {output_path}",
        shell=True, check=True, capture_output=True,
    )


def create_subtitles_with_ffmpeg(transcript_segments, clip_start, clip_end,
                                 clip_video_path, output_path,
                                 caption_color=None, watermark_text=None):
    """Burns captions (and the user's optional watermark) onto a clip.

    The caption look itself — white Poppins with no outline, a rounded pill
    in the user's highlight color behind only the active word — lives in
    captions.build_caption_subs, which scripts/render_caption_test.py can
    render and show visually without a GPU deploy.
    """
    temp_dir = os.path.dirname(output_path)
    subtitle_path = os.path.join(temp_dir, "temp_subtitles.ass")

    subs = build_caption_subs(
        transcript_segments, clip_start, clip_end,
        highlight_rgb=parse_hex_color(caption_color),
    )
    subs.save(subtitle_path)

    filters = [f"ass={subtitle_path}"]
    wm = watermark_filter(watermark_text)
    if wm:
        filters.append(wm)

    ffmpeg_cmd = (
        f"ffmpeg -y -i {clip_video_path} "
        f"-vf \"{','.join(filters)}\" "
        f"-c:v h264_nvenc -preset p6 -cq 18 -b:v 0 "
        f"-c:a copy -movflags +faststart {output_path}"
    )
    subprocess.run(ffmpeg_cmd, shell=True, check=True)


def create_preview_clip(base_dir, original_video_path, s3_key, start_time, end_time, clip_index, title="",
                        watermark_text=None):
    clip_name = f"preview_{clip_index}"
    s3_key_dir = os.path.dirname(s3_key)
    output_s3_key = f"{s3_key_dir}/{clip_name}.mp4"
    thumbnail_s3_key = f"{s3_key_dir}/{clip_name}_thumb.jpg"
    print(f"Preview output S3 key: {output_s3_key}")

    clip_dir = base_dir / clip_name
    clip_dir.mkdir(parents=True, exist_ok=True)
    output_path = clip_dir / "preview.mp4"
    thumbnail_path = clip_dir / "thumb.jpg"
    duration = end_time - start_time

    probe_cmd = (
        f"ffprobe -v error -select_streams v:0 "
        f"-show_entries stream=width,height -of csv=p=0 {original_video_path}"
    )
    probe = subprocess.run(probe_cmd, shell=True, capture_output=True, text=True)
    try:
        src_w, src_h = map(int, probe.stdout.strip().split(","))
    except Exception:
        src_w, src_h = 1920, 1080

    crop_w = min(src_w, int(src_h * 9 / 16))
    crop_h = min(src_h, int(src_w * 16 / 9))
    crop_x = (src_w - crop_w) // 2
    crop_y = (src_h - crop_h) // 2

    preview_filters = [
        f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}",
        "scale=480:854",
        "drawtext=text='PREVIEW':fontsize=24:fontcolor=white@0.6:x=(w-tw)/2:y=20",
    ]
    wm = watermark_filter(watermark_text)
    if wm:
        preview_filters.append(wm)
    ffmpeg_cmd = (
        f"ffmpeg -y -ss {start_time} -t {duration} -i {original_video_path} "
        f'-vf "{",".join(preview_filters)}" '
        f"-c:v h264 -preset ultrafast -crf 30 -c:a aac -b:a 96k {output_path}"
    )
    subprocess.run(ffmpeg_cmd, shell=True, check=True, capture_output=True)
    create_thumbnail(output_path, thumbnail_path, at_seconds=min(1.0, duration * 0.15))

    s3_client = boto3.client("s3")
    s3_client.upload_file(str(output_path), os.environ["S3_BUCKET_NAME"], output_s3_key)
    s3_client.upload_file(str(thumbnail_path), os.environ["S3_BUCKET_NAME"], thumbnail_s3_key)
    print(f"Preview clip uploaded: {output_s3_key}")
    shutil.rmtree(clip_dir, ignore_errors=True)

    return {
        "s3_key": output_s3_key,
        "thumbnail_s3_key": thumbnail_s3_key,
        "title": title,
        "duration": round(duration),
    }


def process_clip(base_dir, original_video_path, s3_key, start_time, end_time, clip_index, transcript_segments, title="",
                 caption_color=None, watermark_text=None):
    clip_name = f"clip_{clip_index}"
    s3_key_dir = os.path.dirname(s3_key)
    output_s3_key = f"{s3_key_dir}/{clip_name}.mp4"
    thumbnail_s3_key = f"{s3_key_dir}/{clip_name}_thumb.jpg"
    print(f"Output S3 key: {output_s3_key}")

    clip_dir = base_dir / clip_name
    clip_dir.mkdir(parents=True, exist_ok=True)

    clip_segment_path = clip_dir / f"{clip_name}_segment.mp4"
    vertical_mp4_path = clip_dir / "pyavi" / "video_out_vertical.mp4"
    subtitle_output_path = clip_dir / "pyavi" / "video_with_subtitles.mp4"

    (clip_dir / "pywork").mkdir(exist_ok=True)
    pyframes_path = clip_dir / "pyframes"
    pyavi_path = clip_dir / "pyavi"
    audio_path = clip_dir / "pyavi" / "audio.wav"
    pyframes_path.mkdir(exist_ok=True)
    pyavi_path.mkdir(exist_ok=True)

    duration = end_time - start_time
    subprocess.run(
        f"ffmpeg -y -ss {start_time} -i {original_video_path} -t {duration} "
        f"-c:v h264_nvenc -preset p5 -cq 18 -b:v 0 "
        f"-c:a aac -b:a 192k -movflags +faststart {clip_segment_path}",
        shell=True, check=True, capture_output=True, text=True
    )
    subprocess.run(
        f"ffmpeg -i {clip_segment_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}",
        shell=True, check=True, capture_output=True
    )

    shutil.copy(clip_segment_path, base_dir / f"{clip_name}.mp4")

    columbia_start_time = time.time()
    subprocess.run(
        f"python demoTalkNet.py --videoName {clip_name} "
        f"--videoFolder {str(base_dir)} --pretrainModel pretrain_TalkSet.model "
        f"--nDataLoaderThread 4",
        cwd="/asd", shell=True, check=True
    )
    print(f"Columbia script completed in {time.time() - columbia_start_time:.2f} seconds")

    tracks_path = clip_dir / "pywork" / "tracks.pckl"
    scores_path = clip_dir / "pywork" / "scores.pckl"
    if not tracks_path.exists() or not scores_path.exists():
        raise FileNotFoundError("Tracks or scores not found for clip")

    with open(tracks_path, "rb") as f:
        tracks = pickle.load(f)
    with open(scores_path, "rb") as f:
        scores = pickle.load(f)

    cvv_start = time.time()
    create_vertical_video(tracks, scores, pyframes_path, pyavi_path, audio_path, vertical_mp4_path)
    print(f"Clip {clip_index} vertical video creation time: {time.time() - cvv_start:.2f} seconds")

    create_subtitles_with_ffmpeg(
        transcript_segments, start_time, end_time,
        vertical_mp4_path, subtitle_output_path,
        caption_color=caption_color, watermark_text=watermark_text,
    )

    thumbnail_path = clip_dir / "thumb.jpg"
    create_thumbnail(subtitle_output_path, thumbnail_path, at_seconds=min(1.0, duration * 0.15))

    s3_client = boto3.client("s3")
    s3_client.upload_file(str(subtitle_output_path), os.environ["S3_BUCKET_NAME"], output_s3_key)
    s3_client.upload_file(str(thumbnail_path), os.environ["S3_BUCKET_NAME"], thumbnail_s3_key)
    shutil.rmtree(clip_dir, ignore_errors=True)
    (base_dir / f"{clip_name}.mp4").unlink(missing_ok=True)

    return {
        "s3_key": output_s3_key,
        "thumbnail_s3_key": thumbnail_s3_key,
        "title": title,
        "duration": round(duration),
    }


# Gemini's window is large enough to swallow even a multi-hour transcript in
# one call, but WhisperX's raw word-level output (one JSON object per single
# word) is a wasteful, awkward representation for that: a 4-hour podcast is
# tens of thousands of word entries, most of the token budget goes to
# repeated "start"/"end"/"word" keys, and the model has to reconstruct
# sentences itself before it can find the "sentence boundaries" the prompt
# asks for. Grouping into sentences first is both far more compact and a
# better match for what the prompt actually needs.
def _fill_word_times(words, default_dur=0.3):
    """Give every word a numeric (start, end) by interpolating across any run
    WhisperX left un-timed.

    WhisperX's forced alignment occasionally fails to time a stretch of words
    (music beds, crosstalk, or drift on longer audio) — those words come back
    with missing or NaN timestamps. The old code dropped them, so captions
    simply vanished for that stretch (the "captions only on half the clip"
    bug). Here we instead interpolate: an interior gap is spread linearly
    between its known neighbours, and leading/trailing gaps step by
    `default_dur`, so captions cover the whole clip. `words` is mutated and
    returned; [] is returned only when nothing is timed at all.
    """
    def timed(w):
        return w["start"] is not None and w["end"] is not None

    n = len(words)
    if not any(timed(w) for w in words):
        return []

    i = 0
    while i < n:
        if timed(words[i]):
            i += 1
            continue
        j = i
        while j < n and not timed(words[j]):
            j += 1
        left_end = words[i - 1]["end"] if i > 0 else None
        right_start = words[j]["start"] if j < n else None
        count = j - i
        if left_end is not None and right_start is not None and right_start > left_end:
            step = (right_start - left_end) / count
            for k in range(count):
                words[i + k]["start"] = left_end + step * k
                words[i + k]["end"] = left_end + step * (k + 1)
        elif left_end is not None:  # trailing gap
            for k in range(count):
                words[i + k]["start"] = left_end + default_dur * k
                words[i + k]["end"] = left_end + default_dur * (k + 1)
        else:  # leading gap — step back from the first known start
            base = (right_start or 0.0) - default_dur * count
            for k in range(count):
                words[i + k]["start"] = max(0.0, base + default_dur * k)
                words[i + k]["end"] = max(0.0, base + default_dur * (k + 1))
        i = j
    return words


def _build_sentence_transcript(word_segments, max_words_per_sentence=50):
    sentences = []
    current_words = []
    current_start = None
    last_end = None
    for w in word_segments:
        word = (w.get("word") or "").strip()
        if not word:
            continue
        if current_start is None:
            current_start = w["start"]
        current_words.append(word)
        last_end = w["end"]
        ends_sentence = word[-1:] in ".?!" or len(current_words) >= max_words_per_sentence
        if ends_sentence:
            sentences.append({
                "start": round(current_start, 2),
                "end": round(last_end, 2),
                "text": " ".join(current_words),
            })
            current_words = []
            current_start = None
    if current_words and current_start is not None:
        sentences.append({
            "start": round(current_start, 2),
            "end": round(last_end, 2),
            "text": " ".join(current_words),
        })
    return sentences


# Fallback LLM used only when Gemini errors or returns unparsable output for
# a chunk. A 7B instruct model is a deliberate choice over a much larger one
# (the repo's old comments floated Qwen2.5-72B via vllm, but that was never
# actually implemented): 72B needs 40GB+ of VRAM on its own, which leaves
# almost no headroom next to the resident WhisperX model on the same L40S
# (48GB total). 7B is more than capable of the actual task here (extracting
# a bounded JSON list from a 20-minute transcript window).
#
# Loaded plain in bf16, not AWQ-quantized: autoawq needs transformers>=4.45
# and torch>=2.4, both newer than the transformers==4.39.3 / torch==2.2.2
# already pinned for WhisperX in this image, so quantizing here would force
# a version bump that risks breaking the transcription pipeline. bf16 costs
# more VRAM (~15GB vs ~5GB for 4-bit) but that's still comfortable headroom
# on a 48GB card, and transformers==4.39.3 already ships Qwen2ForCausalLM
# (added in 4.37), so no extra package is needed at all.
HF_FALLBACK_MODEL_ID = "Qwen/Qwen2.5-7B-Instruct"


def _generate_with_hf(model, tokenizer, prompt_text: str) -> str:
    import torch
    messages = [{"role": "user", "content": prompt_text}]
    chat_text = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = tokenizer(chat_text, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        output_ids = model.generate(
            **inputs, max_new_tokens=4096, do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    generated = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True)


# Windows the sentence transcript into fixed-length time chunks so a single
# Gemini call always covers a bounded amount of source video, no matter how
# long the overall video is. A 20-30 min podcast is one chunk (one call,
# same behavior as before); a 4-hour podcast becomes ~12 chunks, each small
# enough to avoid truncated or malformed JSON output.
CHUNK_TARGET_SECONDS = 20 * 60


def _chunk_sentences(sentences, chunk_seconds=CHUNK_TARGET_SECONDS):
    if not sentences:
        return []
    chunks = []
    current = []
    chunk_start = sentences[0]["start"]
    for s in sentences:
        current.append(s)
        if s["end"] - chunk_start >= chunk_seconds:
            chunks.append(current)
            current = []
            chunk_start = s["end"]
    if current:
        chunks.append(current)
    return chunks


@app.cls(
    # L40S is Modal's recommended inference GPU and has enough VRAM to keep
    # WhisperX plus the alignment model resident. CPU, RAM, and scratch disk
    # are explicitly reserved because decoding, face tracking, and ffmpeg are
    # not purely GPU workloads.
    gpu="L40S",
    cpu=4.0,
    memory=16384,
    # 1 hour was only enough for shorter (~30 min) sources — WhisperX
    # transcription time scales with source length, so a multi-hour podcast
    # needs real headroom here. Raised to 4 hours of wall-clock PROCESSING
    # time, comfortably above the realistic worst case for a 4-hour source
    # (LIMITS.MAX_DURATION_MINUTES in clipcast-frontend/src/lib/limits.ts):
    # transcription scales with source length but runs well faster than
    # realtime on an L40S, and per-clip ASD/render time is bounded by the
    # (fixed, capped-at-12) clip count, not the source length.
    timeout=14400,
    retries=0,
    max_containers=2,
    scaledown_window=120,
    secrets=[modal.Secret.from_name("clipcast-secret")],
    volumes={mount_path: volume, hf_cache_path: hf_volume},
)
class ClipCast:

    @modal.enter()
    def load_model(self):
        print("Loading models")

        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("Modal allocated a GPU but CUDA is unavailable")
        # L40S Tensor Cores accelerate float32 matrix operations with TF32.
        # Whisper inference remains float16; alignment benefits from TF32.
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        print(f"CUDA device: {torch.cuda.get_device_name(0)}")

        # ── Patch TranscriptionOptions to ignore unknown kwargs ──
        import faster_whisper.transcribe as fw_transcribe

        _OriginalOptions = fw_transcribe.TranscriptionOptions

        class PatchedTranscriptionOptions(_OriginalOptions):
            def __new__(cls, **kwargs):
                valid = set(_OriginalOptions._fields)
                cleaned = {k: v for k, v in kwargs.items() if k in valid}
                return _OriginalOptions(**cleaned)

        fw_transcribe.TranscriptionOptions = PatchedTranscriptionOptions

        # Also patch it in faster_whisper.transcribe module reference
        import faster_whisper
        faster_whisper.transcribe.TranscriptionOptions = PatchedTranscriptionOptions
        print("✓ TranscriptionOptions patched to ignore unknown kwargs")
        # ──────────────────────────────────────────────────────────────

        import whisperx
        self.whisperx_model = whisperx.load_model(
            "large-v2", device="cuda", compute_type="float16")

        self.alignment_model, self.metadata = whisperx.load_align_model(
            language_code="en", device="cuda"
        )
        # Persist any first-start downloads so later containers do not fetch the
        # same multi-gigabyte model files again.
        volume.commit()
        hf_volume.commit()
        print("Transcription models loaded...")

        self.gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        print("Created gemini client...")

    def _gemini_llm(self):
        """Wrap the Gemini client in the crew's LLM protocol (or None so a crew
        runs headless on deterministic fallbacks)."""
        client = getattr(self, "gemini_client", None)
        if client is None:
            return None

        class _GeminiLLM:
            def complete(self, system: str, user: str) -> str:
                resp = client.models.generate_content(
                    model="gemini-2.5-flash", contents=f"{system}\n\n{user}"
                )
                return resp.text or ""

        return _GeminiLLM()

    def _get_hf_fallback(self):
        """Lazily load the HF fallback model on first use only.

        Gemini succeeds for the overwhelming majority of chunks, so eagerly
        loading a second resident model in @modal.enter() would pay a real
        VRAM and cold-start cost on every single request for a path that
        rarely runs. Loading it the first time a chunk actually needs it
        keeps the common case fast and only pays for the fallback when it's
        used.
        """
        if getattr(self, "_hf_model", None) is None:
            print(f"Loading HF fallback model ({HF_FALLBACK_MODEL_ID})...")
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer
            self._hf_tokenizer = AutoTokenizer.from_pretrained(HF_FALLBACK_MODEL_ID)
            self._hf_model = AutoModelForCausalLM.from_pretrained(
                HF_FALLBACK_MODEL_ID, device_map="cuda", torch_dtype=torch.bfloat16,
            )
            hf_volume.commit()
            print("HF fallback model loaded.")
        return self._hf_model, self._hf_tokenizer

    @modal.method()
    def identify_moments(self, transcript, clip_mode="qa"):
        """Select clip moments from the transcript using Gemini 2.5 Flash,
        falling back to a resident Hugging Face model for any chunk where
        Gemini errors or returns unparsable output.

        The transcript is windowed into bounded time chunks (see
        `_chunk_sentences`) so this scales to a 4-hour source the same way it
        handles a 20-minute one: each call stays small and fast instead of
        one call whose input and required output both grow with the video's
        length.

        clip_mode == "all" fans out over every mode in ALL_FANOUT_MODES (one
        full Gemini pass per mode per chunk) instead of one blended prompt,
        so "All" actually returns a genuine mix of categories — each moment
        comes back tagged with the mode/category it was found under.
        """

        def _clean_and_validate(raw: str | None) -> list | None:
            """Strip code fences, parse JSON, return list or None on failure."""
            if not raw:
                return None
            cleaned = raw.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[len("```json"):].strip()
            elif cleaned.startswith("```"):
                cleaned = cleaned[3:].strip()
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].strip()
            if cleaned and not cleaned.endswith("]"):
                last_bracket = cleaned.rfind("}")
                if last_bracket != -1:
                    cleaned = cleaned[: last_bracket + 1] + "]"
            try:
                parsed = json.loads(cleaned)
                if isinstance(parsed, list):
                    return parsed
                return None
            except json.JSONDecodeError:
                return None

        sentences = _build_sentence_transcript(transcript)
        if not sentences:
            return json.dumps({
                "moments": [],
                "moment_selection_summary": {
                    "total_chunks": 0, "gemini_chunks": 0,
                    "huggingface_chunks": 0, "failed_chunks": 0,
                },
            })

        chunks = _chunk_sentences(sentences)

        # thinking_budget=0 turns off Gemini 2.5's extended-reasoning tokens:
        # for a long transcript those reasoning tokens were eating into the
        # fixed output-token budget, sometimes leaving no room for the actual
        # JSON and producing a truncated, unparsable response. max_output_tokens
        # is set explicitly so a chunk full of candidate moments never gets
        # cut off mid-JSON either.
        config = genai_types.GenerateContentConfig(
            max_output_tokens=8192,
            thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
        )

        def _run_mode(mode: str) -> tuple[list, list[str]]:
            """Runs one mode's prompt across every chunk, tagging each
            returned moment with this mode's category label (or, for
            "any", whatever category Gemini itself invented)."""
            prompt = CLIP_MODE_PROMPTS.get(mode, CLIP_MODE_PROMPTS["qa"])
            mode_moments: list = []
            sources: list[str] = []

            for chunk_index, chunk in enumerate(chunks):
                chunk_prompt = prompt + json.dumps(chunk)
                moments = None
                source = "none"

                try:
                    response = self.gemini_client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=chunk_prompt,
                        config=config,
                    )
                    gemini_raw = response.text
                    print(
                        f"[{mode}] Gemini chunk {chunk_index + 1}/{len(chunks)} response "
                        f"(first 200 chars): {(gemini_raw or '')[:200]!r}"
                    )
                    moments = _clean_and_validate(gemini_raw)
                    if moments is not None:
                        source = "gemini"
                    elif gemini_raw:
                        print(f"[{mode}] Gemini chunk {chunk_index + 1} returned non-JSON: {gemini_raw[:300]!r}")
                except Exception as err:
                    print(f"[{mode}] Gemini failed on chunk {chunk_index + 1}/{len(chunks)}: {err}")

                if moments is None:
                    try:
                        hf_model, hf_tokenizer = self._get_hf_fallback()
                        hf_raw = _generate_with_hf(hf_model, hf_tokenizer, chunk_prompt)
                        print(
                            f"[{mode}] HF fallback chunk {chunk_index + 1}/{len(chunks)} response "
                            f"(first 200 chars): {(hf_raw or '')[:200]!r}"
                        )
                        moments = _clean_and_validate(hf_raw)
                        if moments is not None:
                            source = "huggingface"
                        elif hf_raw:
                            print(f"[{mode}] HF fallback chunk {chunk_index + 1} returned non-JSON: {hf_raw[:300]!r}")
                    except Exception as err:
                        print(f"[{mode}] HF fallback failed on chunk {chunk_index + 1}/{len(chunks)}: {err}")

                if moments:
                    for m in moments:
                        if isinstance(m, dict):
                            # Fixed modes get their own display label; "any"
                            # keeps whatever category Gemini invented for that
                            # specific moment (falling back to "Moment" if it
                            # left the field out).
                            m["category"] = MODE_CATEGORY_LABELS.get(
                                mode, str(m.get("category") or "Moment").strip()[:40]
                            )
                            m["mode"] = mode
                    mode_moments.extend(moments)
                sources.append(source)

            return mode_moments, sources

        def _overlaps(a: dict, b: dict, threshold: float = 0.5) -> bool:
            """True if two moments share more than `threshold` of the
            shorter one's duration — used to drop near-duplicate moments
            that different modes both flagged over the same stretch of
            transcript when fanning out over every mode for "All"."""
            try:
                a_start, a_end = float(a["start"]), float(a["end"])
                b_start, b_end = float(b["start"]), float(b["end"])
            except (KeyError, TypeError, ValueError):
                return False
            overlap = min(a_end, b_end) - max(a_start, b_start)
            if overlap <= 0:
                return False
            shorter = min(a_end - a_start, b_end - b_start)
            return shorter > 0 and (overlap / shorter) > threshold

        all_moments: list = []
        chunk_sources: list[str] = []

        if clip_mode == "all":
            for mode in ALL_FANOUT_MODES:
                mode_moments, sources = _run_mode(mode)
                chunk_sources.extend(sources)
                for m in mode_moments:
                    if isinstance(m, dict) and not any(_overlaps(m, existing) for existing in all_moments):
                        all_moments.append(m)
        else:
            all_moments, chunk_sources = _run_mode(clip_mode)

        # Drop clips that are too short to stand on their own (the "3-second
        # clip" bug) — a single floor applied after every mode's moments are in.
        def _clip_seconds(m: dict) -> float:
            try:
                return float(m["end"]) - float(m["start"])
            except (KeyError, TypeError, ValueError):
                return 0.0

        before_floor = len(all_moments)
        all_moments = [m for m in all_moments if _clip_seconds(m) >= MIN_CLIP_SECONDS]
        dropped_short = before_floor - len(all_moments)
        if dropped_short:
            print(f"Dropped {dropped_short} clip(s) shorter than {MIN_CLIP_SECONDS:.0f}s")

        summary = {
            "total_chunks": len(chunks),
            "gemini_chunks": chunk_sources.count("gemini"),
            "huggingface_chunks": chunk_sources.count("huggingface"),
            "failed_chunks": chunk_sources.count("none"),
        }
        print(
            f"Moment selection: {summary['gemini_chunks']}/{summary['total_chunks']} chunk(s) via Gemini, "
            f"{summary['huggingface_chunks']} via HF fallback, {summary['failed_chunks']} failed "
            f"({len(all_moments)} moment(s) total)"
        )
        return json.dumps({"moments": all_moments, "moment_selection_summary": summary})

    @modal.method()
    def transcribe_video(self, base_dir, video_path):
        import torch
        import whisperx
        audio_path = base_dir / "audio.wav"
        subprocess.run(
            f"ffmpeg -i {video_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}",
            shell=True, check=True, capture_output=True
        )

        print("Starting transcription with WhisperX...")
        start_time = time.time()

        audio = whisperx.load_audio(str(audio_path))
        with torch.inference_mode():
            result = self.whisperx_model.transcribe(audio, batch_size=16)
            result = whisperx.align(
                result["segments"], self.alignment_model, self.metadata,
                audio, device="cuda", return_char_alignments=False
            )

        print(f"Transcription and alignment took {time.time() - start_time:.2f} seconds")

        import math

        def _num(v):
            """Coerce to float, treating NaN/None/garbage as 'unknown' so it can
            be interpolated rather than silently poisoning the caption times."""
            try:
                f = float(v)
                return None if math.isnan(f) else f
            except (TypeError, ValueError):
                return None

        words = []
        for ws in result.get("word_segments") or []:
            word = (ws.get("word") or "").strip()
            if not word:
                continue
            words.append({
                "word": word,
                "start": _num(ws.get("start")),
                "end": _num(ws.get("end")),
            })
        # Interpolate any un-aligned stretches so captions cover the whole clip.
        words = _fill_word_times(words)
        segments = [
            {"start": w["start"], "end": w["end"], "word": w["word"]}
            for w in words
            if w["start"] is not None and w["end"] is not None
        ]
        del result, audio
        torch.cuda.empty_cache()
        return json.dumps(segments)

    @modal.fastapi_endpoint(method="POST")
    def process_video(
        self,
        request: ProcessVideoRequest,
        token: HTTPAuthorizationCredentials = Depends(auth_scheme),
        base_dir: pathlib.Path = Depends(temporary_workdir),
    ):
        if token.credentials != os.environ["PROCESS_VIDEO_ENDPOINT_AUTH"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect bearer token",
                headers={"WWW-Authenticate": "Bearer"}
            )

        video_path = base_dir / "input.mp4"

        if request.youtube_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Download the YouTube source to S3 with download_youtube_video before starting GPU processing.",
            )

        # ── Download source from S3 ──────────────────────────────────────────
        try:
            boto3.client("s3").download_file(
                os.environ["S3_BUCKET_NAME"], request.s3_key, str(video_path)
            )
        except Exception as s3_err:
            err_str = str(s3_err)
            if "NoSuchKey" in err_str or "404" in err_str:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        f"S3 source not found: {request.s3_key}. "
                        "Make sure the YouTube download completed before starting processing."
                    ),
                ) from s3_err
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to download source from S3: {err_str[:400]}",
            ) from s3_err
        print(f"S3 download complete: {request.s3_key}")

        # ── Validate the downloaded file is a playable video ────────────────
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=size,duration",
             "-of", "json", str(video_path)],
            capture_output=True, text=True, timeout=30,
        )
        if probe.returncode != 0 or not video_path.stat().st_size:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "The downloaded file is not a valid video. "
                    "The source may have been corrupted during download or the S3 upload was incomplete."
                ),
            )

        # ── Transcription ────────────────────────────────────────────────────
        try:
            transcript_json = self.transcribe_video.local(base_dir, video_path)
            transcript_segments = json.loads(transcript_json)
        except subprocess.CalledProcessError as ffmpeg_err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Audio extraction failed (ffmpeg error). "
                    f"The video may have no audio track or an unsupported codec. "
                    f"stderr: {(ffmpeg_err.stderr or '')[:300]}"
                ),
            ) from ffmpeg_err
        except RuntimeError as cuda_err:
            err_str = str(cuda_err)
            if "out of memory" in err_str.lower() or "cuda" in err_str.lower():
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=(
                        "GPU out of memory during transcription. "
                        "The video is likely too long. Try a shorter clip (< 30 min), "
                        "or use preview_only=true to skip the full transcription pipeline."
                    ),
                ) from cuda_err
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Transcription failed: {err_str[:400]}",
            ) from cuda_err
        except Exception as transcribe_err:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Transcription failed unexpectedly: {str(transcribe_err)[:400]}",
            ) from transcribe_err

        if not transcript_segments:
            print("Warning: transcript is empty — no speech detected in video")

        # ── Moment identification (Gemini, HF fallback, windowed by chunk) ───
        # identify_moments handles all errors internally, per chunk, and
        # always returns a valid JSON string. It never raises; a chunk that
        # fails on both Gemini and the HF fallback is skipped rather than
        # failing the job.
        print(f"Identifying clip moments (mode={request.clip_mode})")
        identified_moments_raw = self.identify_moments.local(
            transcript_segments, clip_mode=request.clip_mode
        )

        # Parse the returned JSON string (always valid — guaranteed by identify_moments)
        moment_selection_summary = {}
        try:
            parsed_moments = json.loads(identified_moments_raw) if identified_moments_raw else {}
        except json.JSONDecodeError:
            print(f"Unexpected non-JSON from identify_moments: {identified_moments_raw[:200]!r}")
            parsed_moments = {}
        if isinstance(parsed_moments, dict):
            clip_moments = parsed_moments.get("moments", [])
            moment_selection_summary = parsed_moments.get("moment_selection_summary", {})
        else:
            clip_moments = []
        if not clip_moments or not isinstance(clip_moments, list):
            print("No valid clip moments identified")
            clip_moments = []

        print(clip_moments)

        # Determine duration (seconds) for accurate credit accounting (1 credit
        # per minute). Try OpenCV first, then fall back to ffprobe if the
        # metadata is unreadable so we never under-bill on a bogus 0.
        duration = 0.0
        try:
            cap = cv2.VideoCapture(str(video_path))
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            duration = frame_count / fps if fps > 0 else 0
            cap.release()
        except Exception:
            duration = 0
        if not duration or duration <= 0:
            try:
                probe_dur = subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
                    capture_output=True, text=True, timeout=60,
                )
                duration = float((probe_dur.stdout or "0").strip() or 0)
            except Exception:
                duration = 0

        # Never let malformed or unexpectedly large model output create an
        # unbounded render workload. Clip durations are intentionally bounded
        # around the product's 30-60 second target.
        valid_moments = []
        for moment in clip_moments:
            if not isinstance(moment, dict):
                continue
            try:
                start = float(moment["start"])
                end = float(moment["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if not math.isfinite(start) or not math.isfinite(end):
                continue
            if start < 0 or end <= start or end - start > 120:
                continue
            if duration > 0 and end > duration + 1:
                continue
            title = str(moment.get("title", "") or "").strip()[:80]
            category = str(moment.get("category") or "").strip()[:40] or None
            valid_moments.append({"start": start, "end": end, "title": title, "category": category})
            if len(valid_moments) == 12:
                break

        # ── Render clips ─────────────────────────────────────────────────────
        clips_rendered = 0
        clip_records = []
        clip_errors = []
        production_log = []  # the clip crew's decision transcript (docs/17 §6)
        for index, moment in enumerate(valid_moments):
            print(f"Processing clip {index} ({'PREVIEW' if request.preview_only else 'FULL'}) "
                  f"from {moment['start']} to {moment['end']}")
            try:
                if request.preview_only:
                    record = create_preview_clip(
                        base_dir, video_path, request.s3_key,
                        moment["start"], moment["end"], index, moment["title"],
                        watermark_text=request.watermark_text,
                    )
                else:
                    # User's own color always wins. Otherwise the Colorist agent
                    # (docs/17 §3b) decides the highlight RGB dynamically from the
                    # clip's emotion; the category map is only its fallback.
                    if request.caption_color:
                        effective_caption_color = request.caption_color
                    else:
                        fallback_hex = _category_highlight_hex(moment.get("category")) or "#6366F1"
                        pres, clip_log = plan_clip_presentation(
                            self._gemini_llm(),
                            {
                                "title": moment["title"],
                                "category": moment.get("category"),
                                "transcript": _clip_transcript_snippet(
                                    transcript_segments, moment["start"], moment["end"]
                                ),
                                "fallback_rgb": list(parse_hex_color(fallback_hex)),
                            },
                        )
                        effective_caption_color = _rgb_to_hex(pres["rgb"])
                        production_log.extend({**e, "clip": index} for e in clip_log)
                    record = process_clip(
                        base_dir, video_path, request.s3_key,
                        moment["start"], moment["end"], index, transcript_segments, moment["title"],
                        caption_color=effective_caption_color,
                        watermark_text=request.watermark_text,
                    )
                # Per-clip category: a fixed label ("Q&A", "Educational", …)
                # for the fixed modes, or the AI-invented tag for "any" —
                # also the per-clip source category when the job ran in
                # "all" mode.
                record["category"] = moment.get("category")
                clip_records.append(record)
                clips_rendered += 1
            except subprocess.CalledProcessError as ffmpeg_err:
                msg = (
                    f"Clip {index} ffmpeg render failed "
                    f"(start={moment['start']}, end={moment['end']}): "
                    f"{(ffmpeg_err.stderr or '')[:300]}"
                )
                print(f"Warning: {msg}")
                clip_errors.append(msg)
                # Continue rendering remaining clips instead of aborting all
            except Exception as clip_err:
                msg = f"Clip {index} failed: {str(clip_err)[:200]}"
                print(f"Warning: {msg}")
                clip_errors.append(msg)

        if clip_errors:
            print(f"Clip render warnings ({len(clip_errors)} of {len(valid_moments)} failed):")
            for e in clip_errors:
                print(f"  • {e}")

        # Human-readable record of which model/service actually handled each
        # stage of this job — surfaced to the frontend and stored per job so
        # a video's processing history (which model picked its moments, and
        # whether the HF fallback ever kicked in) is visible, not just an
        # opaque "processed"/"failed" status.
        processing_summary_parts = ["WhisperX large-v2 (transcription)"]
        total_chunks = moment_selection_summary.get("total_chunks", 0)
        if total_chunks:
            gem = moment_selection_summary.get("gemini_chunks", 0)
            hf = moment_selection_summary.get("huggingface_chunks", 0)
            failed = moment_selection_summary.get("failed_chunks", 0)
            moment_part = f"Gemini 2.5 Flash {gem}/{total_chunks} chunk(s) (moments)"
            if hf:
                moment_part += f", HF fallback {HF_FALLBACK_MODEL_ID} {hf}/{total_chunks}"
            if failed:
                moment_part += f", {failed}/{total_chunks} chunk(s) failed"
            processing_summary_parts.append(moment_part)
        processing_summary_parts.append(
            "TalkNet ASD (speaker detection)" if not request.preview_only
            else "TalkNet ASD skipped (preview mode)"
        )
        processing_summary = " · ".join(processing_summary_parts)

        return {
            "success": True,
            "duration": duration,
            "clips_found": len(valid_moments),
            "clips_rendered": clips_rendered,
            "clips": clip_records,
            "processing_summary": processing_summary,
            "production_log": production_log,
            **({"clip_warnings": clip_errors} if clip_errors else {}),
        }


@app.local_entrypoint()
def main(youtube_url: str = None, s3_key: str = None):
    import requests
    import os
    from dotenv import load_dotenv
    
    load_dotenv("../.env")

    url = os.environ.get("PROCESS_VIDEO_ENDPOINT")
    download_url = os.environ.get("DOWNLOAD_VIDEO_ENDPOINT")
    auth_token = os.environ.get("PROCESS_VIDEO_ENDPOINT_AUTH")

    if not s3_key and not youtube_url:
        s3_key = os.environ.get("S3_KEY", "test2/mi630min.mp4")

    if youtube_url:
        s3_key = s3_key or f"youtube/{uuid.uuid4()}/original.mp4"
        print("Requesting cloud YouTube download directly to S3")
        download_response = requests.post(
            download_url,
            json={"youtube_url": youtube_url, "s3_key": s3_key},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {auth_token}",
            },
            timeout=1800,
        )
        download_response.raise_for_status()

    print("Invoking the deployed Modal endpoint; no video processing runs locally")

    response = requests.post(
        url,
        json={
            "s3_key": s3_key or f"youtube/{uuid.uuid4()}/original.mp4",
            "youtube_url": None,
        },
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {auth_token}"}
    )
    
    response.raise_for_status()
    print(response.json())
