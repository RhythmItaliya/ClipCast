"""Caption (.ass) generation for burned-in subtitles.

Kept separate from main.py so the exact production ASS output can be
rendered and visually verified by scripts/render_caption_test.py on a cheap
CPU container before deploying the GPU app.

Style: Submagic/CapCut-like — a few words at a time, clean white Poppins
Black with no outline or box, and a rounded pill in the user's highlight
color behind only the currently-spoken word (with a small pop-in bounce).
"""
import pysubs2
from PIL import ImageFont
from fontTools.ttLib import TTFont

CAPTION_FONT_PATH = "/usr/share/fonts/truetype/custom/Poppins-Black.ttf"

# ClipCast brand indigo — default highlight when the user hasn't picked one.
DEFAULT_HIGHLIGHT_RGB = (99, 102, 241)

PLAY_RES_X = 1080
PLAY_RES_Y = 1920
FONT_SIZE = 120
MARGIN_L = 60
MARGIN_R = 60
# Distance of the caption block's bottom edge from the frame bottom — clears
# a platform's own bottom UI (like/comment/share rail).
MARGIN_V = 320
BOX_PAD_X = 22
BOX_PAD_Y = 6
BOX_RADIUS = 24


def rgb_to_ass_bgr(r, g, b):
    """RGB (0-255 each) -> an ASS override-tag color hex string (BGR order)."""
    return f"{b:02X}{g:02X}{r:02X}"


def parse_hex_color(hex_color, fallback=DEFAULT_HIGHLIGHT_RGB):
    """'#RRGGBB' -> (r, g, b), falling back on any malformed input."""
    if not hex_color:
        return fallback
    value = hex_color.lstrip("#")
    if len(value) != 6:
        return fallback
    try:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback


def _layout_caption_lines(words, font, max_line_width):
    """Greedily wraps `words` into lines that fit `max_line_width` pixels,
    using the exact font the caption is rendered in — so each word's
    on-screen position can be computed precisely instead of relying on
    libass's own automatic wrapping (which doesn't expose per-word pixel
    positions, and so can't be used to place a pill behind just the
    active word).

    Returns a list of lines; each line is a list of
    (word_index, x_offset_within_line, word_width) tuples, plus the line's
    total width for centering.
    """
    space_width = font.getlength(" ")

    lines = []
    current = []
    current_x = 0.0

    for i, word in enumerate(words):
        word_width = font.getlength(word)
        prefix = space_width if current else 0.0
        if current and current_x + prefix + word_width > max_line_width:
            lines.append({"words": current, "total_width": current_x})
            current = []
            current_x = 0.0
            prefix = 0.0
        x_offset = current_x + prefix
        current.append((i, x_offset, word_width))
        current_x = x_offset + word_width

    if current:
        lines.append({"words": current, "total_width": current_x})

    return lines


def _rounded_rect_ass_path(width, height, radius):
    """ASS vector-drawing path (relative to its own anchor) for a filled
    rounded rectangle of the given pixel size."""
    r = min(radius, width / 2, height / 2)
    return (
        f"m {r:.0f} 0 "
        f"l {width - r:.0f} 0 "
        f"b {width:.0f} 0 {width:.0f} 0 {width:.0f} {r:.0f} "
        f"l {width:.0f} {height - r:.0f} "
        f"b {width:.0f} {height:.0f} {width:.0f} {height:.0f} {width - r:.0f} {height:.0f} "
        f"l {r:.0f} {height:.0f} "
        f"b 0 {height:.0f} 0 {height:.0f} 0 {height - r:.0f} "
        f"l 0 {r:.0f} "
        f"b 0 0 0 0 {r:.0f} 0"
    )


def build_caption_subs(
    transcript_segments,
    clip_start,
    clip_end,
    highlight_rgb=DEFAULT_HIGHLIGHT_RGB,
    max_words=4,
    font_path=CAPTION_FONT_PATH,
):
    """Builds the complete SSAFile for one clip's captions.

    transcript_segments: per-word dicts {"word", "start", "end"} in
    source-video time; clip_start/clip_end bound the clip's window.
    """
    highlight_bgr = rgb_to_ass_bgr(*highlight_rgb)
    # libass (VSFilter-compatible) sizes a font so that its OS/2
    # usWinAscent+usWinDescent span equals the style's Fontsize — NOT the
    # em size Pillow's truetype(size=...) uses, and not the hhea metrics
    # either. Read the font's real win metrics and derive the em size that
    # makes Pillow's measurements match what libass actually draws
    # (empirically confirmed word-by-word via scripts/render_caption_test.py:
    # widths matched only under the win-metrics scaling, off by a uniform
    # ~1.3x under hhea scaling).
    tt = TTFont(font_path)
    os2 = tt["OS/2"]
    units_per_em = tt["head"].unitsPerEm
    win_span = os2.usWinAscent + os2.usWinDescent
    em_size = max(1, round(FONT_SIZE * units_per_em / win_span))
    font = ImageFont.truetype(font_path, em_size)
    # Line spacing in this scaling model is exactly Fontsize, with the
    # baseline sitting winAscent into each line's cell.
    line_height = FONT_SIZE
    win_ascent_px = FONT_SIZE * os2.usWinAscent / win_span

    clip_segments = [s for s in transcript_segments
                     if s.get("start") is not None and s.get("end") is not None
                     and s.get("end") > clip_start and s.get("start") < clip_end]

    # Each chunk is a list of (word, start_rel, end_rel) — a few words shown
    # at a time (Submagic-style pacing), breaking early at sentence-ending
    # punctuation so a chunk never straddles two sentences.
    chunks = []
    current_chunk = []
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
        current_chunk.append((word, start_rel, end_rel))
        if word[-1:] in ".?!" or len(current_chunk) >= max_words:
            chunks.append(current_chunk)
            current_chunk = []
    if current_chunk:
        chunks.append(current_chunk)

    subs = pysubs2.SSAFile()
    subs.info["ScaledBorderAndShadow"] = "yes"
    subs.info["PlayResX"] = PLAY_RES_X
    subs.info["PlayResY"] = PLAY_RES_Y
    subs.info["ScriptType"] = "v4.00+"

    style_name = "Default"
    text_style = pysubs2.SSAStyle()
    text_style.fontname = "Poppins Black"
    text_style.fontsize = FONT_SIZE
    text_style.primarycolor = pysubs2.Color(255, 255, 255)
    # Clean white text straight over the video — no outline, no shadow,
    # no box. The active-word pill is the only decoration.
    text_style.outline = 0.0
    text_style.shadow = 0.0
    text_style.alignment = 2
    text_style.marginl = MARGIN_L
    text_style.marginr = MARGIN_R
    text_style.marginv = MARGIN_V
    subs.styles[style_name] = text_style

    # Carrier style for the pill shape events (\p1 drawings only, no text).
    box_style_name = "HighlightBox"
    box_style = pysubs2.SSAStyle()
    box_style.fontsize = FONT_SIZE
    box_style.outline = 0.0
    box_style.shadow = 0.0
    subs.styles[box_style_name] = box_style

    max_line_width = PLAY_RES_X - MARGIN_L - MARGIN_R

    for chunk in chunks:
        words = [w for w, _, _ in chunk]
        lines = _layout_caption_lines(words, font, max_line_width)
        block_height = len(lines) * line_height
        block_bottom_y = PLAY_RES_Y - MARGIN_V
        block_top_y = block_bottom_y - block_height

        # One static text event for the whole chunk with explicit line
        # breaks matching the layout above exactly. A single unchanging
        # event per chunk is what keeps the text flicker-free: nothing
        # about it re-renders at word boundaries.
        chunk_start = chunk[0][1]
        chunk_end = chunk[-1][2]
        line_text = "\\N".join(
            " ".join(words[i] for i, _, _ in line["words"]) for line in lines
        )
        subs.events.append(pysubs2.SSAEvent(
            start=pysubs2.make_time(s=chunk_start),
            end=pysubs2.make_time(s=chunk_end),
            text=line_text, style=style_name,
            layer=1,  # drawn above the pills (layer 0)
        ))

        # One pill per word, visible only during that word's spoken
        # duration, centered on the word's exact on-screen position.
        # \an5 anchors the drawing's center at \pos, so the \fscx/\fscy
        # pop-in bounce grows symmetrically from the middle.
        for line_index, line in enumerate(lines):
            line_top_y = block_top_y + line_index * line_height
            line_left_x = (PLAY_RES_X - line["total_width"]) / 2
            for word_index, x_offset, word_width in line["words"]:
                _, start_rel, end_rel = chunk[word_index]
                if end_rel <= start_rel:
                    continue
                box_w = word_width + 2 * BOX_PAD_X
                # Sized to the glyphs' em box (plus padding) so the pill
                # hugs the word like a tag, and centered on the visual
                # middle of the glyph zone: the baseline sits win_ascent
                # into the line cell, and lowercase-with-ascenders text
                # visually centers a bit under half an em above it.
                box_h = em_size + BOX_PAD_Y * 2
                baseline_y = line_top_y + win_ascent_px
                center_x = line_left_x + x_offset + word_width / 2
                center_y = baseline_y - 0.30 * em_size
                path = _rounded_rect_ass_path(box_w, box_h, BOX_RADIUS)
                box_text = (
                    f"{{\\an5\\pos({center_x:.1f},{center_y:.1f})"
                    f"\\c&H{highlight_bgr}&\\p1"
                    f"\\fscx70\\fscy70"
                    f"\\t(0,90,\\fscx112\\fscy112)"
                    f"\\t(90,170,\\fscx100\\fscy100)"
                    f"}}{path}{{\\p0}}"
                )
                subs.events.append(pysubs2.SSAEvent(
                    start=pysubs2.make_time(s=start_rel),
                    end=pysubs2.make_time(s=end_rel),
                    text=box_text, style=box_style_name,
                    layer=0,
                ))

    return subs
