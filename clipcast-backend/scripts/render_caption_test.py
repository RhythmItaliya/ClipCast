"""Throwaway harness: builds captions with the REAL production module
(apps/processor/captions.py) and renders them over a plain test video on
Modal (same ffmpeg+libass+Poppins stack as the real processor), saving
frames locally so caption styling changes can be SEEN before deploying the
GPU app.

Usage:
    .venv/bin/modal run scripts/render_caption_test.py
    .venv/bin/modal run scripts/render_caption_test.py --highlight "#22c55e"
"""
import pathlib
import sys

import modal

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "apps" / "processor"))

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "wget", "fontconfig")
    .pip_install("pysubs2>=1.6.0", "Pillow>=10.0.0", "fonttools>=4.38.0")
    .run_commands([
        "mkdir -p /usr/share/fonts/truetype/custom",
        "wget -q -O /usr/share/fonts/truetype/custom/Poppins-Black.ttf "
        "    https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Black.ttf",
        "fc-cache -f",
    ])
    .add_local_python_source("captions")
)

app = modal.App("clipcast-caption-test", image=image)

TEST_TRANSCRIPT = [
    {"word": "kaise", "start": 0.0, "end": 0.4},
    {"word": "nikaal", "start": 0.4, "end": 0.9},
    {"word": "de", "start": 0.9, "end": 1.1},
    {"word": "rahe", "start": 1.1, "end": 1.5},
    {"word": "ho", "start": 1.5, "end": 1.8},
    {"word": "aap?", "start": 1.8, "end": 2.2},
]


@app.function(cpu=2.0, memory=1024, timeout=120)
def render(highlight_hex: str, timestamps: list[float]) -> list[bytes]:
    import subprocess

    from captions import build_caption_subs, parse_hex_color

    subs = build_caption_subs(
        TEST_TRANSCRIPT, 0.0, 3.0,
        highlight_rgb=parse_hex_color(highlight_hex),
    )
    ass_path = "/tmp/test.ass"
    subs.save(ass_path)
    print(pathlib.Path(ass_path).read_text())

    # Mid-gray background so both white text and colored pills are visible.
    subprocess.run(
        "ffmpeg -y -f lavfi -i color=c=0x555555:s=1080x1920:r=30:d=3 "
        f"-vf \"ass={ass_path}\" -c:v libx264 -preset ultrafast /tmp/out.mp4",
        shell=True, check=True, capture_output=True,
    )

    frames = []
    for i, ts in enumerate(timestamps):
        frame_path = f"/tmp/frame_{i}.png"
        subprocess.run(
            f"ffmpeg -y -ss {ts} -i /tmp/out.mp4 -vframes 1 {frame_path}",
            shell=True, check=True, capture_output=True,
        )
        frames.append(pathlib.Path(frame_path).read_bytes())
    return frames


@app.local_entrypoint()
def main(highlight: str = "#6366F1"):
    timestamps = [0.2, 0.6, 1.0, 1.3]
    frames = render.remote(highlight, timestamps)
    out_dir = pathlib.Path(
        "/tmp/claude-1000/-home-rhythm-Documents-ClipCast/"
        "cb1368c4-8f19-4d06-acbd-90b49620e935/scratchpad"
    )
    for ts, png in zip(timestamps, frames):
        out = out_dir / f"caption_frame_{ts}s.png"
        out.write_bytes(png)
        print(f"saved {out}")
