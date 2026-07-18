"""clipcast-composer — ACE-Step neural instrumental generator (Modal, GPU).

A single-purpose app that turns a text/genre prompt into a short instrumental
bed with ACE-Step (Apache-2.0). It is INTENTIONALLY isolated from the mixer:
ACE-Step pins transformers==4.50.0 + spacy + pytorch_lightning, which would
fight the mixer's Demucs/MusicGen/Audiobox pins if they shared an image.

The mixer calls `AceComposer.generate` remotely
(`modal.Cls.from_name("clipcast-composer", "AceComposer")`) and treats any
failure here as "neural bed unavailable" — it falls back to its deterministic
sample composer, so this app can never break a render.

Contract:
    generate(prompt: str, duration_seconds: float, seed: int) -> bytes
    → returns the generated instrumental as WAV bytes (44.1 kHz on the mixer
      side after its own resample; ACE-Step's native rate is returned as-is and
      the mixer resamples/warps to the target grid).
"""

import pathlib
import uuid

import modal

CACHE = "/cache"
CHECKPOINT_DIR = f"{CACHE}/acestep-checkpoints"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install_from_requirements("requirements.txt")
    # ACE-Step from git in its own layer (torch is already pinned above, so its
    # heavy deps — diffusers/transformers/spacy/pytorch_lightning — resolve
    # against a fixed torch instead of exploding pip's resolver).
    .pip_install("git+https://github.com/ace-step/ACE-Step.git")
    # ACE-Step downloads its weights from HuggingFace on first init; cache them
    # (and any HF assets) in the persisted volume so warm starts are instant.
    .env({"HF_HOME": CACHE, "TORCH_HOME": CACHE})
)

app = modal.App("clipcast-composer", image=image)
model_volume = modal.Volume.from_name("clipcast-composer-models", create_if_missing=True)


@app.cls(
    gpu="L4",  # ACE-Step 3.5B fits in ~8GB with offload; L4 (24GB) is plenty + cheap.
    cpu=4.0,
    memory=16384,
    timeout=1200,
    retries=0,
    max_containers=2,
    scaledown_window=120,  # stay warm between a job's parts
    volumes={CACHE: model_volume},
)
class AceComposer:
    @modal.enter()
    def load(self):
        # Loaded once per warm container. If ACE-Step can't load, generate()
        # raises and the mixer falls back — so we don't swallow it here.
        from acestep.pipeline_ace_step import ACEStepPipeline

        pathlib.Path(CHECKPOINT_DIR).mkdir(parents=True, exist_ok=True)
        self.pipe = ACEStepPipeline(
            checkpoint_dir=CHECKPOINT_DIR,
            dtype="bfloat16",
            torch_compile=False,
            cpu_offload=False,
            overlapped_decode=False,
        )
        model_volume.commit()

    @modal.method()
    def generate(self, prompt: str, duration_seconds: float, seed: int) -> bytes:
        """Generate one instrumental take for `prompt`. No lyrics → instrumental."""
        import soundfile as sf

        work = pathlib.Path("/tmp") / str(uuid.uuid4())
        work.mkdir(parents=True, exist_ok=True)
        out_path = work / "bed.wav"
        try:
            # Duration is clamped to a sane hook length; ACE-Step is diffusion,
            # so `seed` makes takes reproducible + lets variations differ.
            dur = float(max(8.0, min(45.0, duration_seconds)))
            self.pipe(
                audio_duration=dur,
                prompt=prompt,
                lyrics="",  # instrumental only
                infer_step=27,
                guidance_scale=15.0,
                scheduler_type="euler",
                cfg_type="apg",
                omega_scale=10.0,
                manual_seeds=str(int(seed)),
                guidance_interval=0.5,
                guidance_interval_decay=0.0,
                min_guidance_scale=3.0,
                use_erg_tag=True,
                use_erg_lyric=False,
                use_erg_diffusion=True,
                oss_steps="",
                guidance_scale_text=0.0,
                guidance_scale_lyric=0.0,
                save_path=str(out_path),
            )
            wav_path = _find_output(out_path, work)
            if wav_path is None:
                raise RuntimeError("ACE-Step produced no output file")
            data, sr = sf.read(str(wav_path), dtype="float32")
            # Return a normalized WAV payload the mixer can read from bytes.
            buf = work / "payload.wav"
            sf.write(str(buf), data, sr, subtype="PCM_16")
            model_volume.commit()
            return buf.read_bytes()
        finally:
            import shutil

            shutil.rmtree(work, ignore_errors=True)


def _find_output(preferred: pathlib.Path, work: pathlib.Path) -> pathlib.Path | None:
    """ACE-Step may honour save_path exactly or write near it — accept either."""
    if preferred.exists():
        return preferred
    candidates = [
        p for p in work.rglob("*")
        if p.suffix.lower() in {".wav", ".flac", ".mp3", ".ogg"} and p.is_file()
    ]
    return max(candidates, key=lambda p: p.stat().st_size) if candidates else None
