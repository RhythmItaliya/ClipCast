# ClipCast 12: Captions & clip branding

## The look

Submagic/CapCut style: 2-4 words on screen at a time, clean white Poppins
Black with **no outline, shadow or background panel**, and a rounded pill in
the user's highlight color behind only the currently-spoken word, with a
pop-in bounce (`\fscx 70 -> 112 -> 100` over 170ms).

## Where it lives

`clipcast-backend/apps/processor/captions.py` — `build_caption_subs()`
returns a complete pysubs2 `SSAFile`; `main.py`'s
`create_subtitles_with_ffmpeg` saves it and burns it with ffmpeg's `ass=`
filter (h264_nvenc). Kept as its own module so the exact production code is
testable without a GPU deploy.

## How the pill lands exactly on the word

libass can't draw a per-word background, so the pill is a separate ASS
`\p1` rounded-rect drawing event per word, absolutely positioned. That
requires knowing where libass puts every word:

- **Font scaling**: libass (VSFilter-compatible) sizes a font so its OS/2
  `usWinAscent + usWinDescent` span equals the style Fontsize — NOT the em
  size Pillow uses. `captions.py` reads the win metrics with fontTools and
  derives the matching Pillow em size (for Poppins: 1823/1000 units, ~1.82x).
  Getting this wrong shifts every pill (~1.3x drift under hhea metrics; the
  original bug looked like dark boxes behind whole lines).
- **Layout**: words are greedily wrapped with real Pillow advances; the text
  event uses explicit `\N` breaks matching that layout so libass never
  re-wraps differently. Line height = Fontsize; baseline sits winAscent into
  the cell; pill centers at `baseline - 0.30 * em`.
- **Flicker fix**: ONE static text event per chunk (layer 1) for its whole
  duration; pills are separate layer-0 events per word. The old design
  (re-emitting the full text per word) redrew everything at every word
  boundary.

## Visual verification before deploying

`clipcast-backend/scripts/render_caption_test.py` runs the real
`captions.py` on a Modal CPU container (same ffmpeg/libass/Poppins as
production), renders frames over gray, and saves PNGs locally:

    .venv/bin/modal run scripts/render_caption_test.py --highlight "#22c55e"

Never ship caption styling changes without looking at these frames.

## Per-user branding

- `User.captionColor` (`#RRGGBB`, null = brand indigo #6366F1) and
  `User.watermarkText` (null/empty = **no watermark at all** — nothing is
  hardcoded), edited in Settings → Clip appearance (8 swatches + text input,
  `updateClipAppearance` action).
- Flow: Inngest reads both in the `check-credits` step → Modal request body
  (`caption_color`, `watermark_text`) → `ProcessVideoRequest` →
  `process_clip`/`create_preview_clip`. Watermark renders via a drawtext
  filter (`watermark_filter()`, escaped, 40-char cap, low-opacity white,
  top-right); previews get the watermark but not captions.
