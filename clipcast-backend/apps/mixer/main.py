"""ClipCast Audio Studio engine (Modal, single warm GPU container).

Two jobs, one app, one warm container — see docs/14, docs/15, docs/16:

  • GENERATE — text/genre → an original track (MusicGen; swap to ACE-Step for
    an Apache-2.0 commercial path).
  • MASHUP   — two S3 sources → Demucs htdemucs_ft stem split → BPM/key
    analysis → Rubber Band tempo-stretch + Camelot pitch-shift → **AI
    arrangement** (Gemini decides which vocal part lands where, with DJ ducking
    and an intro build) → render → **Audiobox-Aesthetics rating feedback loop**
    (re-render, keep the best-scoring take) → loudness master → S3.

One `@app.cls` keeps Gemini + the aesthetics rater warm across jobs (like the
processor's model class). Fully independent of the processor/downloader apps.
Stateless: job rows/credits/status stay the frontend's job. Shared bearer token
(PROCESS_VIDEO_ENDPOINT_AUTH), S3_BUCKET_NAME, and GEMINI_API_KEY all come from
the existing clipcast-secret — no new secrets.
"""

import os
import pathlib
import shutil
import subprocess
import uuid

import modal
from fastapi import Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

# Genre presets (docs/14): a genre is a prompt seed + default tempo. Mirror in
# the frontend's audio-studio-client.tsx GENRES list.
GENRE_PRESETS: dict[str, dict] = {
    "lofi": {"seed": "lofi hip-hop, mellow, vinyl crackle, jazzy keys, relaxed", "bpm": 80},
    "ambient": {"seed": "ambient, atmospheric evolving pads, no drums, calm, cinematic", "bpm": 0},
    "cinematic": {"seed": "cinematic orchestral, strings, building, emotional", "bpm": 75},
    "trap": {"seed": "trap beat, heavy 808 bass, crisp hi-hat rolls, hard", "bpm": 140},
    "house": {"seed": "house, four-on-the-floor, synth stabs, energetic", "bpm": 124},
    "pop": {"seed": "modern pop, catchy, bright, radio-ready", "bpm": 110},
    "bollywood": {"seed": "Bollywood, dholak, tabla, Indian melody, festive", "bpm": 100},
    "rock": {"seed": "rock, electric guitar, live drums, driving", "bpm": 120},
}

# Best open separation model: htdemucs_ft (fine-tuned) — slower than htdemucs
# but noticeably cleaner vocals, which is the most audible part of a mashup.
DEMUCS_MODEL = "htdemucs_ft"
CACHE = "/cache"


class AudioSource(BaseModel):
    s3_key: str
    role: str = "auto"  # "auto" | "vocal" | "bed" | "extra"
    label: str | None = None


class ProcessAudioRequest(BaseModel):
    mode: str = "mashup"  # "generate" | "mashup"
    out_prefix: str = ""
    call_id: str | None = None
    # generate
    prompt: str | None = None
    genre: str | None = None
    duration_seconds: int = 20
    # mashup: keep SINGING from vocal_s3_key, MUSIC from bed_s3_key
    vocal_s3_key: str | None = None
    bed_s3_key: str | None = None
    # advanced mashup: one or more sources; the mixer auto-detects roles.
    sources: list[AudioSource] | None = None
    transform_strength: str = "auto"  # "auto" | "clean" | "subtle" | "transformed" | "max"
    remix_duration_seconds: int | None = None
    # Force the target production lane for a mashup. "auto" (or None) lets the
    # mixer pick the lane from the sources; any preset overrides it. Same preset
    # vocabulary as the generate genres (see GENRE_PRESETS / decide_mix_style).
    target_genre: str | None = None


image = (
    modal.Image.debian_slim(python_version="3.11")
    # fluidsynth + a GM soundfont power the basic-pitch → MIDI melody replay.
    .apt_install(
        "ffmpeg", "rubberband-cli", "fluidsynth", "fluid-soundfont-gm"
    )
    .pip_install_from_requirements("requirements.txt")
    .env({"TORCH_HOME": CACHE, "HF_HOME": CACHE})
    .add_local_python_source("audio_engine", "crew", "music_crew", "monitoring")
)

app = modal.App("clipcast-mixer", image=image)
auth_scheme = HTTPBearer()
model_volume = modal.Volume.from_name("clipcast-mixer-models", create_if_missing=True)


def _s3():
    import boto3

    return boto3.client("s3")


def _download_from_s3(s3_key: str, dest: pathlib.Path) -> None:
    _s3().download_file(os.environ["S3_BUCKET_NAME"], s3_key, str(dest))


def _upload_to_s3(path: pathlib.Path, s3_key: str, content_type: str) -> None:
    _s3().upload_file(str(path), os.environ["S3_BUCKET_NAME"], s3_key, ExtraArgs={"ContentType": content_type})


def _extract_audio(src: pathlib.Path, dest_wav: pathlib.Path) -> None:
    """mp4 (from the downloader) or audio → 44.1 kHz stereo (music rate)."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-vn", "-ar", "44100", "-ac", "2", str(dest_wav)],
        check=True, capture_output=True,
    )


def _demucs_four_stems(input_wav: pathlib.Path, out_dir: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path, dict[str, pathlib.Path]]:
    """Full modern extraction: split into vocals / drums / bass / other with the
    best open model, then sum drums+bass+other into one instrumental so the
    downstream file-based analysis stays unchanged. Returns
    (vocals, instrumental, all_four_stem_paths) — the user asked to "extract all
    the vocal, instrument and everything" first."""
    import numpy as np
    import soundfile as sf

    subprocess.run(
        ["python", "-m", "demucs", "-n", DEMUCS_MODEL, "-o", str(out_dir), str(input_wav)],
        check=True, capture_output=True, env={**os.environ, "TORCH_HOME": CACHE},
    )
    stem_dir = out_dir / DEMUCS_MODEL / input_wav.stem
    stems = {name: stem_dir / f"{name}.wav" for name in ("vocals", "drums", "bass", "other")}

    instrumental = stem_dir / "instrumental.wav"
    inst_sum, sr = None, 44100
    for name in ("drums", "bass", "other"):
        y, sr = sf.read(str(stems[name]), dtype="float32")
        inst_sum = y if inst_sum is None else inst_sum + y
    peak = float(np.max(np.abs(inst_sum))) if inst_sum is not None and inst_sum.size else 0.0
    if peak > 0.98:
        inst_sum = inst_sum / peak * 0.98
    sf.write(str(instrumental), inst_sum, sr, subtype="PCM_16")
    return stems["vocals"], instrumental, stems


@app.cls(
    gpu="L40S",
    cpu=4.0,
    memory=16384,
    timeout=3600,
    retries=0,  # a partial mashup should never be silently retried
    max_containers=2,
    scaledown_window=120,
    secrets=[modal.Secret.from_name("clipcast-secret")],
    volumes={CACHE: model_volume},
)
class ClipCastMixer:
    @modal.enter()
    def load(self):
        # Gemini — the AI arrangement brain. Optional: falls back to a
        # deterministic energy-based arrangement if unavailable.
        self.gemini = None
        key = os.environ.get("GEMINI_API_KEY")
        if key:
            try:
                from google import genai

                self.gemini = genai.Client(api_key=key)
            except Exception as e:  # noqa: BLE001
                print(f"Gemini unavailable, using deterministic arrangement: {e}")
        # Audiobox-Aesthetics — the audio rater that drives the feedback loop.
        self.aes = None
        try:
            from audiobox_aesthetics.infer import initialize_predictor

            self.aes = initialize_predictor()
        except Exception as e:  # noqa: BLE001
            print(f"Audiobox-Aesthetics unavailable, scoring disabled: {e}")
        # faster-whisper — reads the vocal stem's lyrics so the AI director can
        # plan the genre transform from the song's meaning. Optional: no lyrics
        # → the director falls back to a deterministic genre plan.
        self.whisper = None
        try:
            from faster_whisper import WhisperModel

            self.whisper = WhisperModel(
                "base", device="cuda", compute_type="float16", download_root=CACHE
            )
        except Exception as e:  # noqa: BLE001
            print(f"faster-whisper unavailable, lyric understanding disabled: {e}")

    # ── AI rating ────────────────────────────────────────────────────────────
    def _rate(self, wav_path: str) -> dict | None:
        """Production Quality / Complexity / Content Enjoyment/Usefulness, 1-10."""
        if not self.aes:
            return None
        try:
            out = self.aes.forward([{"path": wav_path}])
            return out[0] if out else None
        except Exception as e:  # noqa: BLE001
            print(f"aesthetics scoring failed: {e}")
            return None

    def _compose_prompt(self, user_prompt: str, genre: str | None, preset_seed: str) -> str:
        """Turn a short user idea into a tighter producer prompt. This gives the
        text-to-music model arrangement, instrumentation, and mix direction
        instead of a bare genre word."""
        base = ", ".join(p for p in (user_prompt, preset_seed) if p).strip(", ")
        if not base:
            base = "modern instrumental song"
        if not self.gemini:
            return base
        prompt = (
            "You are a professional music producer writing a concise prompt for "
            "a text-to-music model. Include genre, tempo feel, instruments, "
            "arrangement arc, and mix style. Do not mention copyrighted artists "
            "or specific songs. Output one sentence under 60 words.\n"
            f"User idea: {user_prompt or 'none'}\n"
            f"Genre preset: {genre or 'auto'}\n"
            f"Preset seed: {preset_seed or 'none'}"
        )
        try:
            resp = self.gemini.models.generate_content(model="gemini-2.5-flash", contents=prompt)
            text = (resp.text or "").strip().replace("\n", " ")
            return text[:500] or base
        except Exception as e:  # noqa: BLE001
            print(f"Gemini composer prompt failed, using base prompt: {e}")
            return base

    # ── AI Music Director (lyric understanding → producer plan) ───────────────
    def _transcribe_lyrics(self, vocal_path: str) -> str:
        """Transcribe the isolated vocal stem to lyrics (empty on failure or a
        near-instrumental source)."""
        if not getattr(self, "whisper", None):
            return ""
        try:
            segments, _info = self.whisper.transcribe(
                vocal_path, beam_size=1, vad_filter=True
            )
            return " ".join(seg.text.strip() for seg in segments).strip()[:2000]
        except Exception as e:  # noqa: BLE001
            print(f"lyric transcription failed: {e}")
            return ""

    def _gemini_llm(self):
        """Wrap the warm Gemini client in the crew's LLM protocol (or None so
        the crew runs headless on deterministic fallbacks)."""
        client = getattr(self, "gemini", None)
        if client is None:
            return None

        class _GeminiLLM:
            def complete(self, system: str, user: str) -> str:
                resp = client.models.generate_content(
                    model="gemini-2.5-flash", contents=f"{system}\n\n{user}"
                )
                return resp.text or ""

        return _GeminiLLM()

    def _producer_plan(self, lyrics: str, genre: str, target_bpm: float, key_name: str, quality: str):
        """Run the music crew (docs/17 §3a): lyricist → director → composer →
        engineer produce the plan the render consumes, plus the ProductionLog.
        Returns (plan, production_log). Never raises — agents fall back."""
        from music_crew import music_plan

        brief = {
            "genre": genre,
            "target_bpm": target_bpm,
            "key_name": key_name,
            "quality": quality,
            "lyrics": (lyrics or "")[:1500],
        }
        try:
            return music_plan(self._gemini_llm(), brief)
        except Exception as e:  # noqa: BLE001
            print(f"music crew failed, using deterministic plan: {e}")
            mellow = (genre or "").split()[0] in {"lofi", "ambient", "cinematic"}
            plan = {
                "mood": "introspective, mellow" if mellow else "energetic, bright",
                "bed_prompt": (
                    f"{genre} instrumental, {target_bpm:.0f} BPM, key {key_name} {quality}, "
                    "clean production, no vocals, tight drums, musical, cohesive"
                ),
                "fx_bias": "clean" if mellow else "viral",
                "note": f"deterministic {genre} plan",
            }
            return plan, []

    # ── Neural genre bed (ACE-Step, isolated app) ─────────────────────────────
    def _neural_bed(
        self, prompt: str, target_bpm: float, duration_sec: float, seed: int
    ):
        """Ask the isolated ACE-Step composer app for a genre instrumental and
        tempo-lock it to the target grid. Returns stereo @ 44.1 kHz, or None if
        the composer app is unavailable — the caller then keeps the
        deterministic sample composer, so a render never depends on ACE-Step."""
        try:
            import io

            import audio_engine as ae
            import librosa
            import numpy as np
            import pyrubberband as pyrb
            import soundfile as sf

            composer = modal.Cls.from_name("clipcast-composer", "AceComposer")()
            wav_bytes = composer.generate.remote(prompt, float(duration_sec), int(seed))
            y, gsr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
            y = ae._to_stereo(np.asarray(y, dtype=np.float32))
            if gsr != 44100:
                y = np.stack(
                    [librosa.resample(y[:, ch], orig_sr=gsr, target_sr=44100) for ch in range(2)],
                    axis=1,
                ).astype(np.float32)
            # Tempo-lock to the grid; pitch is steered by the prompt's key hint
            # and its modest level under the on-grid deterministic bed.
            gen_bpm, _ = ae.detect_bpm_and_beats(y.mean(axis=1), 44100)
            ratio = ae.tempo_ratio(gen_bpm, target_bpm)
            if abs(ratio - 1.0) > 1e-3:
                y = ae._to_stereo(np.asarray(pyrb.time_stretch(y, 44100, ratio), dtype=np.float32))
            return y
        except Exception as e:  # noqa: BLE001
            print(f"neural bed unavailable, using deterministic composer: {e}")
            return None

    # ── Jobs ─────────────────────────────────────────────────────────────────
    @modal.method()
    def run_job(self, request_dict: dict) -> dict:
        req = ProcessAudioRequest(**request_dict)
        base_dir = pathlib.Path("/tmp") / str(uuid.uuid4())
        base_dir.mkdir(parents=True, exist_ok=True)
        try:
            result = self._generate(req, base_dir) if req.mode == "generate" else self._mashup(req, base_dir)
            model_volume.commit()
            return result
        finally:
            shutil.rmtree(base_dir, ignore_errors=True)

    def _build_part(
        self,
        item: dict,
        sr: int,
        part_sec: float,
        target_bpm: float,
        ref_analysis,
        hook: tuple[float, float] | None = None,
    ) -> dict:
        """Turn one source into the raw material for a "part": find the catchiest
        window (the best part), then tempo/key-warp its vocal + instrumental to
        the shared grid. The expensive Rubber Band warp happens here ONCE; the
        genre composer, vocal overlay, and FX are applied cheaply per variation
        in the finish stage. Handles lyric and instrumental sources alike."""
        import audio_engine as ae
        import numpy as np
        import pyrubberband as pyrb
        import soundfile as sf

        voc_full = ae._to_stereo(sf.read(str(item["vocals"]), dtype="float32")[0])
        inst_full = ae._to_stereo(sf.read(str(item["instrumental"]), dtype="float32")[0])

        if hook is None:
            mono = (voc_full.mean(axis=1) + inst_full.mean(axis=1)).astype(np.float32)
            hook = ae.detect_hook(mono, sr, window_sec=part_sec, n=1)[0]

        vslice = ae.slice_segment(voc_full, sr, hook[0], hook[1])
        islice = ae.slice_segment(inst_full, sr, hook[0], hook[1])
        tune_only, vocal_ratio = ae.is_tune_only(vslice, islice)
        _, beats = ae.detect_bpm_and_beats(islice.mean(axis=1), sr)

        source_bpm = item["bed_analysis"].bpm
        ratio = ae.tempo_ratio(source_bpm, target_bpm)
        semis = 0 if ref_analysis is None else ae.semitones_to_compatible(item["bed_analysis"], ref_analysis)

        def _warp(y: np.ndarray) -> np.ndarray:
            if abs(ratio - 1.0) > 1e-3:
                y = pyrb.time_stretch(y, sr, ratio)
            if semis != 0:
                y = pyrb.pitch_shift(y, sr, semis)
            return ae._to_stereo(np.asarray(y, dtype=np.float32))

        key_root = (ae._PITCHES.index(item["bed_analysis"].key) + semis) % 12
        return {
            "label": item["label"],
            "vocal": _warp(vslice),
            "inst": _warp(islice),
            "beats": [b / ratio for b in beats] if ratio > 0 else beats,
            "key_root": key_root,
            "is_minor": item["bed_analysis"].is_minor,
            "genre": item["profile"]["genre"],
            "tune_only": tune_only,
            "has_vocals": vocal_ratio >= 0.12,
            "meta": {
                "label": item["label"],
                "tune_only": tune_only,
                "has_vocals": vocal_ratio >= 0.12,
                "vocal_ratio": round(vocal_ratio, 2),
                "hook": (round(hook[0], 1), round(hook[1], 1)),
                "semis": semis,
                "source_bpm": source_bpm,
            },
        }

    def _mashup(self, req: ProcessAudioRequest, base_dir: pathlib.Path) -> dict:
        import audio_engine as ae
        import soundfile as sf

        if req.sources:
            source_reqs = req.sources[:6]
        elif req.vocal_s3_key and req.bed_s3_key:
            source_reqs = [
                AudioSource(s3_key=req.vocal_s3_key, role="vocal", label="Vocal track"),
                AudioSource(s3_key=req.bed_s3_key, role="bed", label="Beat track"),
            ]
        else:
            raise HTTPException(422, "mashup needs sources, or vocal_s3_key and bed_s3_key")

        sr = 44100
        analyzed = []
        for idx, source in enumerate(source_reqs):
            # 1. Ingest every source → 44.1 kHz stereo.
            src = base_dir / f"source_{idx + 1}"
            wav = base_dir / f"source_{idx + 1}.wav"
            _download_from_s3(source.s3_key, src)
            _extract_audio(src, wav)

            # 2. Full extraction: vocals / drums / bass / other, then a summed
            # instrumental so roles + genre can be detected automatically.
            vocals, instrumental, _stems = _demucs_four_stems(wav, base_dir / f"stems_{idx + 1}")
            balance = ae.stem_balance(str(vocals), str(instrumental))
            bed_analysis = ae.analyze_track(str(instrumental))
            inst_y, inst_sr = sf.read(str(instrumental), dtype="float32")
            inst_mono = inst_y if inst_y.ndim == 1 else inst_y.mean(axis=1)
            source_genre = ae.infer_genre(inst_mono, inst_sr, bed_analysis.bpm)
            analyzed.append(
                {
                    "idx": idx,
                    "label": source.label or f"Source {idx + 1}",
                    "role": (source.role or "auto").lower(),
                    "vocals": vocals,
                    "instrumental": instrumental,
                    "source_wav": str(wav),  # original recording → mastering reference
                    "balance": balance,
                    "bed_analysis": bed_analysis,
                    "profile": {
                        "label": source.label or f"Source {idx + 1}",
                        "genre": source_genre,
                        "bpm": bed_analysis.bpm,
                        "camelot": bed_analysis.camelot,
                        "vocal_ratio": balance["vocal_ratio"],
                        **ae.audio_features(inst_mono, inst_sr, bed_analysis.bpm),
                    },
                }
            )

        def _pick(candidates, key):
            pool = candidates or analyzed
            return max(pool, key=key)

        explicit_vocals = [item for item in analyzed if item["role"] == "vocal"]
        explicit_beds = [item for item in analyzed if item["role"] == "bed"]
        vocal_pick = _pick(explicit_vocals, lambda item: item["balance"]["vocal_energy"])
        bed_candidates = explicit_beds or [item for item in analyzed if item["idx"] != vocal_pick["idx"]]
        bed_pick = _pick(
            bed_candidates,
            lambda item: item["balance"]["instrumental_energy"] * (1.0 + item["balance"]["instrumental_ratio"]),
        )

        # 3. Decide the target production lane + tempo before joining anything.
        # A user-picked genre forces the lane; "auto"/None keeps auto-detection.
        style_plan = ae.decide_mix_style(
            [item["profile"] for item in analyzed], user_genre=req.target_genre
        )
        target_bpm = float(style_plan["target_bpm"])
        ref_analysis = vocal_pick["bed_analysis"]  # harmonic anchor: both parts land in this key

        # 4. A short viral edit = two catchy parts joined with a transition. Two
        # sources → one hook each ("X × ABC"); one source → its two best hooks.
        # Length is AI-decided from the tempo unless the user forced one.
        overlap_sec = 3.0
        n_parts = 2
        target_total, part_sec = ae.decide_edit_length(
            target_bpm, req.remix_duration_seconds, n_parts=n_parts, overlap_sec=overlap_sec
        )
        length_mode = "user" if req.remix_duration_seconds else "auto"

        if vocal_pick["idx"] != bed_pick["idx"]:
            part_specs = [(vocal_pick, None), (bed_pick, None)]
        else:
            solo = vocal_pick
            solo_voc, _ = sf.read(str(solo["vocals"]), dtype="float32")
            solo_inst, _ = sf.read(str(solo["instrumental"]), dtype="float32")
            solo_mono = ae._to_stereo(solo_voc).mean(axis=1) + ae._to_stereo(solo_inst).mean(axis=1)
            hooks = ae.detect_hook(solo_mono, sr, window_sec=part_sec, n=2)
            part_specs = [(solo, hooks[0]), (solo, hooks[1] if len(hooks) > 1 else hooks[0])]

        built = [self._build_part(item, sr, part_sec, target_bpm, ref_analysis, hook) for item, hook in part_specs]
        part_metas = [p["meta"] for p in built]
        style_label = style_plan["style"]

        # AI Music Director: read the vocal's lyrics + emotion, then plan the
        # genre transform (mood + a genre instrumental prompt for ACE-Step).
        # Degrades to a deterministic genre plan if Whisper/Gemini are absent.
        lead_key = ae._PITCHES[built[0]["key_root"] % 12]
        lead_quality = "minor" if built[0]["is_minor"] else "major"
        lyrics = self._transcribe_lyrics(str(vocal_pick["vocals"]))
        plan, production_log = self._producer_plan(
            lyrics, style_label, target_bpm, lead_key, lead_quality
        )
        director_prompt = plan["bed_prompt"]

        # Neural genre bed (ACE-Step) + melody re-instrumentation (basic-pitch →
        # FluidSynth), computed ONCE per part, both driven by the director's plan.
        # Both degrade to None and the deterministic composer if their model/app
        # is unavailable, so this is additive quality that can never break a render.
        for pi, p in enumerate(built):
            p["neural_bed"] = self._neural_bed(director_prompt, target_bpm, part_sec, seed=1000 + pi)

            # Carry the recognisable tune: transcribe the vocal (or the
            # instrumental when the part is tune-only) and replay it in-genre.
            mel_src = p["vocal"] if p["has_vocals"] else p["inst"]
            mel_path = base_dir / f"melody_src_{pi}.wav"
            ae.write_wav(mel_src, sr, str(mel_path))
            p["melody"] = ae.reinstrument_melody(str(mel_path), sr, style_label)

        neural_on = any(p.get("neural_bed") is not None for p in built)
        melody_on = any(p.get("melody") is not None for p in built)

        # 5. Produce MULTIPLE clips (not just one). The heavy work (separation,
        # warp) is done once; each variation only re-runs the cheap genre
        # composer + vocal overlay + FX + sequence, so 3 distinct edits are near
        # free. When the user forced a beat-originality strength we honour it and
        # only vary order + FX; on Auto we also vary the production intensity.
        if req.transform_strength == "auto":
            variations = [
                ("Remix", (0, 1), style_plan["transform_strength"], "viral"),
                ("Flip", (1, 0), "max", "viral"),
                ("Chill", (0, 1), "subtle", "clean"),
            ]
        else:
            s = req.transform_strength
            variations = [
                ("Remix", (0, 1), s, "viral"),
                ("Flip", (1, 0), s, "viral"),
                ("Clean", (0, 1), s, "clean"),
            ]

        def _render_part(p: dict, strength: str, fx: str):
            import audio_engine as ae

            bed = ae.reproduce_bed(
                p["inst"], sr, p["beats"], genre=style_label, strength=strength,
                key_root=p["key_root"], is_minor=p["is_minor"],
            )
            # Layer the neural genre bed + re-instrumented melody at
            # strength-scaled levels. Both are None-safe (no-op when the model
            # was unavailable) and a "clean" take stays fully deterministic.
            neural_level = {"clean": 0.0, "subtle": 0.14, "transformed": 0.24, "max": 0.34}.get(strength, 0.2)
            melody_level = {"clean": 0.0, "subtle": 0.10, "transformed": 0.16, "max": 0.22}.get(strength, 0.14)
            bed = ae.layer_in(bed, p.get("neural_bed"), neural_level)
            bed = ae.layer_in(bed, p.get("melody"), melody_level)
            audio = (
                bed
                if p["tune_only"] or not p["has_vocals"]
                else ae.render_mashup(p["vocal"], bed, sr, 0.0, ae.DEFAULT_MIX_PARAMS)
            )
            return ae.apply_fx_chain(audio, sr, preset=fx)

        source_genres = ", ".join(f"{item['label']}={item['profile']['genre']}" for item in analyzed)
        parts_txt = " × ".join(
            f"{m['label']}[{m['hook'][0]:.0f}-{m['hook'][1]:.0f}s → {target_bpm:.0f}BPM"
            f"{', %+dst' % m['semis'] if m['semis'] else ''}"
            f"{', tune-only' if (m['tune_only'] or not m['has_vocals']) else ''}]"
            for m in part_metas
        )

        reference_wav = bed_pick.get("source_wav") or vocal_pick.get("source_wav")

        # Render + master + rate ONE take. The score comes from Meta's
        # Audiobox-Aesthetics (a specialist open model built to judge audio
        # quality) — never a homemade metric.
        def _make_take(vi: int, tag: str, strength: str, fx: str) -> dict:
            parts = [_render_part(built[idx], strength, fx) for idx in order]
            edit = ae.sequence_parts(parts, sr, target_total, overlap_sec=overlap_sec)
            wav_p = base_dir / f"v{vi}{tag}.wav"
            raw_p = base_dir / f"v{vi}{tag}_raw.wav"
            ae.write_wav(edit, sr, str(raw_p))
            mastered = bool(reference_wav) and ae.reference_master(str(raw_p), reference_wav, str(wav_p))
            if not mastered:
                ae.write_wav(ae.normalize_loudness(edit, sr), sr, str(wav_p))
            scores = self._rate(str(wav_p))
            return {
                "wav_p": wav_p,
                "scores": scores,
                "pq": scores.get("PQ") if scores else None,
                "master_mode": "matchering" if mastered else "loudnorm",
                "mixed_dur": edit.shape[0] / sr,
                "fx": fx,
            }

        # If Audiobox rates a take below target, redo it once with a cleaner FX
        # pass — a producer sending a take back — and keep whichever scores
        # higher. Bounded to one retry; the heavy work (Demucs/warp/ACE-Step) is
        # already cached, so only the cheap FX pass + re-score repeat.
        TARGET_PQ = 7.0
        clips = []
        for vi, (name, order, strength, fx) in enumerate(variations, start=1):
            take = _make_take(vi, "", strength, fx)
            redone = False
            if take["pq"] is not None and take["pq"] < TARGET_PQ and fx != "clean":
                redone = True
                alt = _make_take(vi, "_alt", strength, "clean")
                if (alt["pq"] or 0.0) > (take["pq"] or 0.0):
                    take = alt

            wav_p, scores = take["wav_p"], take["scores"]
            master_mode, mixed_dur = take["master_mode"], take["mixed_dur"]
            mp3_p = base_dir / f"v{vi}.mp3"
            ae.encode_mp3(str(wav_p), str(mp3_p))
            wav_key, mp3_key = f"{req.out_prefix}v{vi}_master.wav", f"{req.out_prefix}v{vi}_master.mp3"
            _upload_to_s3(wav_p, wav_key, "audio/wav")
            _upload_to_s3(mp3_p, mp3_key, "audio/mpeg")
            pq_txt = f"{scores['PQ']:.1f}/10" if scores and "PQ" in scores else "n/a"
            fx_txt = f"{take['fx']} (redone)" if redone else fx
            order_txt = " × ".join(part_metas[idx]["label"] for idx in order)
            clips.append(
                {
                    "s3_key": mp3_key,
                    "wav_s3_key": wav_key,
                    "duration": mixed_dur,
                    "title": f"AI Hook Mix — {name}",
                    "processing_summary": (
                        f"{name} ({order_txt}) · Demucs {DEMUCS_MODEL} 4-stem · "
                        f"composer kit {ae.style_to_kit(style_label)} "
                        f"(+neural {'on' if neural_on else 'off'}, "
                        f"+melody {'on' if melody_on else 'off'}) ({strength}) · "
                        f"FX {fx_txt} · master {master_mode} · parts {parts_txt} · "
                        f"style {style_label} ({target_bpm:.0f} BPM) · "
                        f"director {plan['note']} · "
                        f"length {mixed_dur:.1f}s ({length_mode}) · Audiobox PQ {pq_txt}"
                    ),
                }
            )

        first = clips[0]
        return {
            "success": True,
            "clips": clips,
            "sources_genres": source_genres,
            # The crew's decision transcript (docs/17 §6) — surfaced in the
            # Production Room UI once persisted (Phase 4).
            "production_log": production_log,
            # top-level fields = first clip, for older single-result callers.
            "duration": first["duration"],
            "s3_key": first["s3_key"],
            "wav_s3_key": first["wav_s3_key"],
            "title": "AI Hook Mix",
            "processing_summary": first["processing_summary"],
        }

    def _generate(self, req: ProcessAudioRequest, base_dir: pathlib.Path) -> dict:
        import audio_engine as ae
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration

        genre_key = (req.genre or "").lower()
        preset = GENRE_PRESETS.get(genre_key, {}) if genre_key != "auto" else {}
        prompt = self._compose_prompt(req.prompt or "", req.genre, preset.get("seed", ""))

        proc = AutoProcessor.from_pretrained("facebook/musicgen-medium", cache_dir=CACHE)
        model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-medium", cache_dir=CACHE).to("cuda")
        inputs = proc(text=[prompt], padding=True, return_tensors="pt").to("cuda")
        max_new_tokens = max(256, min(int(req.duration_seconds), 60) * 50)  # ~50 tok/s
        with torch.inference_mode():
            wav = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=max_new_tokens)
        sr = model.config.audio_encoder.sampling_rate
        audio = ae.normalize_loudness(wav[0, 0].cpu().numpy(), sr)

        master_wav, master_mp3 = base_dir / "master.wav", base_dir / "master.mp3"
        ae.write_wav(audio, sr, str(master_wav))
        ae.encode_mp3(str(master_wav), str(master_mp3))
        wav_key, mp3_key = f"{req.out_prefix}master.wav", f"{req.out_prefix}master.mp3"
        _upload_to_s3(master_wav, wav_key, "audio/wav")
        _upload_to_s3(master_mp3, mp3_key, "audio/mpeg")

        pq = self._rate(str(master_wav))
        pq_txt = f" · Audiobox PQ {pq['PQ']:.1f}/10" if pq and "PQ" in pq else ""
        return {
            "success": True,
            "duration": len(audio) / sr,
            "s3_key": mp3_key,
            "wav_s3_key": wav_key,
            "title": (req.genre or "Generated").capitalize() + " track",
            "processing_summary": f"MusicGen medium · AI composer prompt: {prompt[:140]}{pq_txt}",
        }


@app.function(
    cpu=0.25,
    memory=512,
    timeout=60,
    max_containers=10,
    scaledown_window=60,
    secrets=[modal.Secret.from_name("clipcast-secret")],
)
@modal.fastapi_endpoint(method="POST")
def process_audio(
    request: ProcessAudioRequest,
    token: HTTPAuthorizationCredentials = Depends(auth_scheme),
):
    """Cheap CPU router: submit spawns the warm GPU class method; poll reads it.
    Same submit/poll contract the Inngest queue already speaks to the downloader."""
    if token.credentials != os.environ["PROCESS_VIDEO_ENDPOINT_AUTH"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if request.call_id:
        function_call = modal.FunctionCall.from_id(request.call_id)
        try:
            result = function_call.get(timeout=0)
        except TimeoutError:
            return JSONResponse(
                {"status": "pending", "call_id": request.call_id},
                status_code=status.HTTP_202_ACCEPTED,
            )
        except modal.exception.OutputExpiredError as error:
            raise HTTPException(404, "Audio result expired; submit the job again.") from error
        except Exception as error:
            raise HTTPException(502, f"Audio worker failed: {str(error)[-1000:]}") from error
        return {"status": "completed", "call_id": request.call_id, **result}

    if not request.out_prefix:
        raise HTTPException(422, "out_prefix is required when submitting a job.")

    function_call = ClipCastMixer().run_job.spawn(request.model_dump())
    return JSONResponse(
        {"status": "accepted", "call_id": function_call.object_id},
        status_code=status.HTTP_202_ACCEPTED,
    )
