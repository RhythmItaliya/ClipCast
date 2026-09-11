# ClipCast E2E Test Report

- **Overall:** ✅ **PASS**
- **Run (UTC):** 2026-09-11T14:16:04.557798+00:00 → 2026-09-11T14:18:55.493153+00:00
- **Duration:** 2m 50s
- **Machine report JSON:** `/home/rhythm/Documents/ClipCast/testing/reports/e2e-20260911T141604Z/report.json`

## Environment

| Key | Value |
| --- | --- |
| python | 3.12.3 |
| boto3_available | True |
| local_download_endpoint | http://localhost:3000/api/local-download |
| process_video_endpoint | https://littlemovie00--clipcast-clipcast-process-video.modal.run |
| process_audio_endpoint | https://littlemovie00--clipcast-mixer-process-audio.modal.run |
| s3_bucket | my-video-storage-app-281414549138-us-west-2-an |
| aws_region | us-west-2 |
| llm_provider | claude |
| llm_model | claude-opus-4-8 |
| llm_effort | medium |
| llm_api_key_source | ANTHROPIC_API_KEY |

## Stages

| Stage | Status | Time | Detail |
| --- | --- | --- | --- |
| audio_generate | ✅ PASS | 2m 50s | s3_key=audio/e2e-c10a3172-b4ac-4e4c-808d-a4441019f385/master.mp3, duration=19.94 |

## Audio Studio

- **Output:** `audio/e2e-c10a3172-b4ac-4e4c-808d-a4441019f385/master.mp3`
- **WAV master:** `audio/e2e-c10a3172-b4ac-4e4c-808d-a4441019f385/master.wav`
- **Duration:** 19.94s
- **Presigned URL (1h):** https://my-video-storage-app-281414549138-us-west-2-an.s3.amazonaws.com/audio/e2e-c10a3172-b4ac-4e4c-808d-a4441019f385/master.mp3?AWSAccessKeyId=AKIAUDBM5H2JMWOLUFYR&Signature=lhhrbqRZpqirUcL7%2F7dxLRZ%2BLDA%3D&Expires=1789139935
- **Summary:** MusicGen medium · AI composer prompt: An upbeat, mellow lo-fi hip hop instrumental featuring jazzy Rhodes chords, warm bass, and dusty boom-bap drums, maintaining a relaxed, stea · Audiobox PQ 7.3/10

## Bugs / anomalies

- None found.
