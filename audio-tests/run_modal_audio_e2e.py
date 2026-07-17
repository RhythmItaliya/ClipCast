"""Run a real deployed Audio Studio E2E test.

Flow:
  YouTube downloader Modal endpoint -> S3 source files -> mixer Modal endpoint
  -> S3 master outputs -> local audio-tests/e2e-* folder.

This script intentionally reads secrets from ../.env but never prints them.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import uuid
import argparse
from datetime import datetime

import boto3
import requests


ROOT = pathlib.Path(__file__).resolve().parents[1]
TEST_ROOT = ROOT / "audio-tests"

DEFAULT_VOCAL_URL = "https://www.youtube.com/watch?v=O33LNl_Cyoc"
DEFAULT_BED_URL = "https://www.youtube.com/watch?v=uF0kv8tfi3o"


def load_env(path: pathlib.Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def write_json(path: pathlib.Path, payload) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))


class E2E:
    def __init__(
        self,
        vocal_url: str,
        bed_url: str,
        vocal_label: str,
        bed_label: str,
        transform_strength: str,
        remix_duration_seconds: int,
    ) -> None:
        self.env = {**os.environ, **load_env(ROOT / ".env")}
        self.run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        self.out_dir = TEST_ROOT / f"e2e-youtube-mix-{self.run_id}"
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.out_dir / "events.log"
        self.vocal_url = vocal_url
        self.bed_url = bed_url
        self.vocal_label = vocal_label
        self.bed_label = bed_label
        self.transform_strength = transform_strength
        self.remix_duration_seconds = remix_duration_seconds
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.env['PROCESS_VIDEO_ENDPOINT_AUTH']}",
        }

    def log(self, message: str) -> None:
        stamp = datetime.now().isoformat(timespec="seconds")
        line = f"[{stamp}] {message}"
        print(line, flush=True)
        with self.log_path.open("a") as fh:
            fh.write(line + "\n")

    def post(self, url: str, payload: dict) -> tuple[int, dict, str]:
        response = requests.post(url, headers=self.headers, json=payload, timeout=120)
        text = response.text
        try:
            data = response.json()
        except ValueError:
            data = {}
        return response.status_code, data, text

    def submit_and_poll(
        self,
        endpoint: str,
        submit_payload: dict,
        label: str,
        max_attempts: int,
    ) -> dict:
        status, data, text = self.post(endpoint, submit_payload)
        write_json(self.out_dir / f"{label}-submit.json", {"status": status, "data": data, "body": text[:2000]})
        if status != 202 or not data.get("call_id"):
            raise RuntimeError(f"{label} submit failed: HTTP {status} {text[:500]}")

        call_id = data["call_id"]
        self.log(f"{label}: submitted call_id={call_id}")
        time.sleep(20)
        for attempt in range(1, max_attempts + 1):
            status, data, text = self.post(endpoint, {"call_id": call_id})
            write_json(
                self.out_dir / f"{label}-poll-{attempt:02d}.json",
                {"status": status, "data": data, "body": text[:2000]},
            )
            if status == 202:
                wait = min(15 + (attempt - 1) * 5, 60)
                self.log(f"{label}: pending attempt={attempt}, wait={wait}s")
                time.sleep(wait)
                continue
            if not (200 <= status < 300):
                raise RuntimeError(f"{label} failed: HTTP {status} {text[:800]}")
            self.log(f"{label}: completed")
            return data
        raise TimeoutError(f"{label} did not finish within {max_attempts} poll attempts")

    def download_s3(self, key: str, dest: pathlib.Path) -> None:
        client = boto3.client(
            "s3",
            region_name=self.env["AWS_REGION"],
            aws_access_key_id=self.env["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=self.env["AWS_SECRET_ACCESS_KEY"],
        )
        client.download_file(self.env["S3_BUCKET_NAME"], key, str(dest))
        self.log(f"downloaded {key} -> {dest.name}")

    def run(self) -> pathlib.Path:
        required = [
            "DOWNLOAD_VIDEO_ENDPOINT",
            "PROCESS_AUDIO_ENDPOINT",
            "PROCESS_VIDEO_ENDPOINT_AUTH",
            "AWS_REGION",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "S3_BUCKET_NAME",
        ]
        missing = [key for key in required if not self.env.get(key)]
        if missing:
            raise RuntimeError(f"Missing env keys: {', '.join(missing)}")

        source1_key = f"audio-tests/{self.run_id}/vocal_source.mp4"
        source2_key = f"audio-tests/{self.run_id}/bed_source.mp4"
        out_prefix = f"audio-tests/{self.run_id}/output/"
        inputs = {
            "run_id": self.run_id,
            "vocal_url": self.vocal_url,
            "bed_url": self.bed_url,
            "source1_s3_key": source1_key,
            "source2_s3_key": source2_key,
            "out_prefix": out_prefix,
            "transform_strength": self.transform_strength,
            "remix_duration_seconds": self.remix_duration_seconds,
        }
        write_json(self.out_dir / "inputs.json", inputs)
        self.log(f"test folder: {self.out_dir}")

        self.submit_and_poll(
            self.env["DOWNLOAD_VIDEO_ENDPOINT"],
            {"youtube_url": self.vocal_url, "s3_key": source1_key},
            "download-vocal",
            max_attempts=90,
        )
        self.submit_and_poll(
            self.env["DOWNLOAD_VIDEO_ENDPOINT"],
            {"youtube_url": self.bed_url, "s3_key": source2_key},
            "download-bed",
            max_attempts=90,
        )

        mixer_result = self.submit_and_poll(
            self.env["PROCESS_AUDIO_ENDPOINT"],
            {
                "mode": "mashup",
                "out_prefix": out_prefix,
                "transform_strength": self.transform_strength,
                "remix_duration_seconds": self.remix_duration_seconds,
                "sources": [
                    {"s3_key": source1_key, "role": "vocal", "label": self.vocal_label},
                    {"s3_key": source2_key, "role": "bed", "label": self.bed_label},
                ],
            },
            "mixer",
            max_attempts=120,
        )
        write_json(self.out_dir / "mixer-result.json", mixer_result)

        clips = mixer_result.get("clips") or (
            [{"s3_key": mixer_result.get("s3_key"), "wav_s3_key": mixer_result.get("wav_s3_key"),
              "title": mixer_result.get("title")}]
            if mixer_result.get("s3_key")
            else []
        )
        for idx, clip in enumerate(clips, start=1):
            title = (clip.get("title") or f"clip{idx}").replace(" ", "_").replace("—", "-")
            if clip.get("s3_key"):
                self.download_s3(clip["s3_key"], self.out_dir / f"v{idx}_{title}.mp3")
            if clip.get("wav_s3_key"):
                self.download_s3(clip["wav_s3_key"], self.out_dir / f"v{idx}_{title}.wav")
        self.log(f"done — {len(clips)} clip(s)")
        return self.out_dir


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run a deployed ClipCast audio mixer E2E test.")
    parser.add_argument("--vocal-url", default=DEFAULT_VOCAL_URL)
    parser.add_argument("--bed-url", default=DEFAULT_BED_URL)
    parser.add_argument("--vocal-label", default="No Copyright Vocal")
    parser.add_argument("--bed-label", default="No Copyright Instrumental")
    parser.add_argument(
        "--transform-strength",
        default="auto",
        choices=["auto", "clean", "subtle", "transformed", "max"],
    )
    parser.add_argument("--remix-duration-seconds", type=int, default=0)  # 0 = AI decides
    args = parser.parse_args()
    try:
        out = E2E(
            vocal_url=args.vocal_url,
            bed_url=args.bed_url,
            vocal_label=args.vocal_label,
            bed_label=args.bed_label,
            transform_strength=args.transform_strength,
            remix_duration_seconds=args.remix_duration_seconds,
        ).run()
        print(f"\nE2E output folder: {out}")
    except Exception as exc:
        print(f"\nE2E failed: {exc}", file=sys.stderr)
        raise
