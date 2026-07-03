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

import pysubs2
from tqdm import tqdm


class ProcessVideoRequest(BaseModel):
    s3_key: str
    youtube_url: str | None = None
    clip_mode: str = "qa"
    preview_only: bool = False


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
- Output only JSON: [{"start": seconds, "end": seconds}, ...]. Must be parseable by json.loads().
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
- Output only JSON: [{"start": seconds, "end": seconds}, ...]. Must be parseable by json.loads().
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
- Output only JSON: [{"start": seconds, "end": seconds}, ...]. Must be parseable by json.loads().
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
- Output only JSON: [{"start": seconds, "end": seconds}, ...]. Must be parseable by json.loads().
- Target 40-60 second clips.
- Exclude: greetings, slow warm-up conversation, or generic statements.
- If no valid clips exist output [].

Transcript:
""",
    "all": """\
This is a podcast video transcript. I need clips between 30-60 seconds long.
Find the best short-form clips of ANY type — insightful questions and answers,
motivational or emotional stories, educational lessons, and viral, quotable highlights.
Pick the strongest, most self-contained moments regardless of category.

Rules:
- Clips must not overlap.
- Start/end timestamps must match sentence boundaries in the transcript exactly.
- Only use timestamps from the input — do not modify them.
- Output only JSON: [{"start": seconds, "end": seconds}, ...]. Must be parseable by json.loads().
- Target 40-60 second clips.
- Density: aim for roughly 1 high-quality clip per 5 minutes of podcast.
- Exclude: greetings, thank-yous, farewells, and filler conversation.
- If no valid clips exist output [].

Transcript:
""",
}

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
        "wget -O /usr/share/fonts/truetype/custom/Anton-Regular.ttf "
        "    https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf",
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


def create_subtitles_with_ffmpeg(transcript_segments, clip_start, clip_end, clip_video_path, output_path, max_words=5):
    temp_dir = os.path.dirname(output_path)
    subtitle_path = os.path.join(temp_dir, "temp_subtitles.ass")

    clip_segments = [s for s in transcript_segments
                     if s.get("start") is not None and s.get("end") is not None
                     and s.get("end") > clip_start and s.get("start") < clip_end]

    subtitles = []
    current_words = []
    current_start = current_end = None

    for segment in clip_segments:
        word = segment.get("word", "").strip()
        seg_start = segment.get("start")
        seg_end = segment.get("end")
        if not word or seg_start is None or seg_end is None:
            continue
        start_rel = max(0.0, seg_start - clip_start)
        end_rel = max(0.0, seg_end - clip_start)
        if end_rel <= 0:
            continue
        if not current_words:
            current_start = start_rel
            current_end = end_rel
            current_words = [word]
        elif len(current_words) >= max_words:
            subtitles.append((current_start, current_end, ' '.join(current_words)))
            current_words = [word]
            current_start = start_rel
            current_end = end_rel
        else:
            current_words.append(word)
            current_end = end_rel

    if current_words:
        subtitles.append((current_start, current_end, ' '.join(current_words)))

    subs = pysubs2.SSAFile()
    subs.info["WrapStyle"] = 0
    subs.info["ScaledBorderAndShadow"] = "yes"
    subs.info["PlayResX"] = 1080
    subs.info["PlayResY"] = 1920
    subs.info["ScriptType"] = "v4.00+"

    style_name = "Default"
    new_style = pysubs2.SSAStyle()
    new_style.fontname = "Anton"
    new_style.fontsize = 140
    new_style.primarycolor = pysubs2.Color(255, 255, 255)
    new_style.outline = 2.0
    new_style.shadow = 2.0
    new_style.shadowcolor = pysubs2.Color(0, 0, 0, 128)
    new_style.alignment = 2
    new_style.marginl = 50
    new_style.marginr = 50
    new_style.marginv = 50
    new_style.spacing = 0.0
    subs.styles[style_name] = new_style

    for start, end, text in subtitles:
        subs.events.append(pysubs2.SSAEvent(
            start=pysubs2.make_time(s=start),
            end=pysubs2.make_time(s=end),
            text=text, style=style_name
        ))

    subs.save(subtitle_path)

    ffmpeg_cmd = (
        f"ffmpeg -y -i {clip_video_path} "
        f"-vf \"ass={subtitle_path},drawtext=text='ClipCast':"
        f"fontfile=/usr/share/fonts/truetype/custom/Anton-Regular.ttf:"
        f"x=w-tw-40:y=40:fontsize=60:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3\" "
        f"-c:v h264_nvenc -preset p6 -cq 18 -b:v 0 "
        f"-c:a copy -movflags +faststart {output_path}"
    )
    subprocess.run(ffmpeg_cmd, shell=True, check=True)


def create_preview_clip(base_dir, original_video_path, s3_key, start_time, end_time, clip_index):
    clip_name = f"preview_{clip_index}"
    s3_key_dir = os.path.dirname(s3_key)
    output_s3_key = f"{s3_key_dir}/{clip_name}.mp4"
    print(f"Preview output S3 key: {output_s3_key}")

    clip_dir = base_dir / clip_name
    clip_dir.mkdir(parents=True, exist_ok=True)
    output_path = clip_dir / "preview.mp4"
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

    ffmpeg_cmd = (
        f"ffmpeg -y -ss {start_time} -t {duration} -i {original_video_path} "
        f'-vf "crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale=480:854,'
        f'drawtext=text=\'PREVIEW\':fontsize=24:fontcolor=white@0.6:x=(w-tw)/2:y=20,'
        f'drawtext=text=\'ClipCast\':fontsize=32:fontcolor=white:x=w-tw-20:y=20" '
        f"-c:v h264 -preset ultrafast -crf 30 -c:a aac -b:a 96k {output_path}"
    )
    subprocess.run(ffmpeg_cmd, shell=True, check=True, capture_output=True)

    s3_client = boto3.client("s3")
    s3_client.upload_file(str(output_path), os.environ["S3_BUCKET_NAME"], output_s3_key)
    print(f"Preview clip uploaded: {output_s3_key}")
    shutil.rmtree(clip_dir, ignore_errors=True)


def process_clip(base_dir, original_video_path, s3_key, start_time, end_time, clip_index, transcript_segments):
    clip_name = f"clip_{clip_index}"
    s3_key_dir = os.path.dirname(s3_key)
    output_s3_key = f"{s3_key_dir}/{clip_name}.mp4"
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

    create_subtitles_with_ffmpeg(transcript_segments, start_time, end_time, vertical_mp4_path, subtitle_output_path, max_words=5)

    boto3.client("s3").upload_file(str(subtitle_output_path), os.environ["S3_BUCKET_NAME"], output_s3_key)
    shutil.rmtree(clip_dir, ignore_errors=True)
    (base_dir / f"{clip_name}.mp4").unlink(missing_ok=True)


@app.cls(
    # L40S is Modal's recommended inference GPU and has enough VRAM to keep
    # WhisperX plus the alignment model resident. CPU, RAM, and scratch disk
    # are explicitly reserved because decoding, face tracking, and ffmpeg are
    # not purely GPU workloads.
    gpu="L40S",
    cpu=4.0,
    memory=16384,
    timeout=3600,
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

    @modal.method()
    def identify_moments(self, transcript, clip_mode="qa"):
        """Select clip moments from the transcript using Gemini 2.5 Flash."""
        prompt = CLIP_MODE_PROMPTS.get(clip_mode, CLIP_MODE_PROMPTS["qa"])
        full_prompt = prompt + str(transcript)

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

        try:
            response = self.gemini_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=full_prompt,
            )
            gemini_raw = response.text
            print(f"Gemini response (first 200 chars): {(gemini_raw or '')[:200]!r}")
            moments = _clean_and_validate(gemini_raw)
            if moments is not None:
                print(f"Gemini identified {len(moments)} moment(s)")
                return json.dumps(moments)
            print(f"Gemini returned non-JSON: {(gemini_raw or '')[:300]!r}")
            return json.dumps([])
        except Exception as err:
            print(f"Gemini failed: {err}")
            return json.dumps([])

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

        segments = []
        if "word_segments" in result:
            for ws in result["word_segments"]:
                if "start" not in ws or "end" not in ws:
                    continue
                segments.append({
                    "start": ws["start"],
                    "end": ws["end"],
                    "word": ws.get("word", ""),
                })
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

        # ── Moment identification (Gemini → HF fallback) ─────────────────────
        # identify_moments handles all errors internally. It returns a JSON
        # string (always valid) — Gemini first, then Qwen2.5-72B-AWQ if Gemini
        # fails. It never raises; failure returns json.dumps([]).
        print(f"Identifying clip moments (mode={request.clip_mode})")
        identified_moments_raw = self.identify_moments.local(
            transcript_segments, clip_mode=request.clip_mode
        )

        # Parse the returned JSON string (always valid — guaranteed by identify_moments)
        try:
            clip_moments = json.loads(identified_moments_raw) if identified_moments_raw else []
        except json.JSONDecodeError:
            print(f"Unexpected non-JSON from identify_moments: {identified_moments_raw[:200]!r}")
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
            valid_moments.append({"start": start, "end": end})
            if len(valid_moments) == 12:
                break

        # ── Render clips ─────────────────────────────────────────────────────
        clips_rendered = 0
        clip_errors = []
        for index, moment in enumerate(valid_moments):
            print(f"Processing clip {index} ({'PREVIEW' if request.preview_only else 'FULL'}) "
                  f"from {moment['start']} to {moment['end']}")
            try:
                if request.preview_only:
                    create_preview_clip(
                        base_dir, video_path, request.s3_key,
                        moment["start"], moment["end"], index
                    )
                else:
                    process_clip(
                        base_dir, video_path, request.s3_key,
                        moment["start"], moment["end"], index, transcript_segments
                    )
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

        return {
            "success": True,
            "duration": duration,
            "clips_found": len(valid_moments),
            "clips_rendered": clips_rendered,
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
