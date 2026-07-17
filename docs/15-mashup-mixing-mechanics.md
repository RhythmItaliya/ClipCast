# ClipCast 15: How we actually join two songs (mixing mechanics)

> **Status: plan only.** This is the deep-dive companion to
> [14-audio-studio-mode.md](14-audio-studio-mode.md). Doc 14 is the pipeline
> and the tool stack; **this doc explains the *music* part in plain language**
> — why two songs clash, what "join them" really means, how a beat gets
> matched, and how a new beat is made — then maps every concept to the exact
> automated step and tool. **You do not need to know anything about music to
> read this.** Nothing here is composed by hand; the system does all of it.

## The one-sentence version

A good mashup = **take the singing from song A, take the music/beat from song
B, make them run at the same speed, make them agree in pitch, line up their
beats, remove the parts that would fight each other, and join them on a
natural boundary.** Everything below is just those steps, explained and
automated.

## Why two songs clash (the 5 things that must agree)

Think of a song as **layers stacked on a grid**.

1. **Speed (tempo / BPM)** — every song has a pulse, measured in *beats per
   minute*. Song A might be 90, song B 120. Play them together untouched and
   they drift apart like two people clapping at different speeds. → We
   **stretch one to match the other's speed.**
2. **The grid (beats → bars → phrases)** — beats come in groups of 4 called a
   **bar**; bars come in groups of 4 or 8 called a **phrase**. Songs change
   (verse→chorus) on phrase lines. If "beat 1 of the bar" of the two songs
   don't sit on top of each other, the mix feels drunk even at the same BPM. →
   We **align the downbeats** (the "1" of each bar) and only join on phrase
   lines.
3. **Pitch (key / harmony)** — a song uses a set of notes (its *key*). Two
   songs in clashing keys sound sour together, like two singers in different
   tunings. → We **shift one song's pitch** to a friendly key (the "Camelot"
   trick, below).
4. **Structure (intro / verse / chorus / outro)** — the loud singing part is
   the **chorus** (a.k.a. the drop/hook); intros and outros are usually just
   beat, no vocals — the easy places to blend. → We **join during the calm
   parts and land the vocal on the chorus.**
5. **Frequency layers (who occupies the low/mid/high)** — bass lives low,
   vocals live in the middle, cymbals live high. Two basslines at once = mud;
   two lead vocals at once = noise. → We **remove the layers that would
   fight** — this is the "remove to join them" idea.

If all five agree, the two songs sound like they were *made* together. Our job
is to force all five to agree, automatically.

## "Remove to join them" = stem swapping

You asked how removing parts lets them join. Here it is concretely.

Every song is really four hidden layers (**stems**): **vocals, drums, bass,
other-melody**. **Demucs** (doc 14, stage 2) pulls them apart.

To join song A (the voice we want) with song B (the beat we want):

| Song | Keep | Remove | Why |
|---|---|---|---|
| A | **vocals** (the "acapella") | drums, bass, other | we only want A's singing |
| B | **drums + bass + other** (the "instrumental") | vocals | we only want B's music, not its singer |

Now there is exactly **one** voice (A's) and **one** set of music (B's) — no
mud, no clashing double-vocals. That removal *is* what makes the join clean.
Then we stack them back together on the grid. That's a mashup.

> The user picks the direction on the form (doc 14 UX): "A sings over B's
> beat," or swap it. Default = the second URL is the beat.

## Matching the beat (this is the "beat sync")

Three moves, in order. All automated (doc 14, stages 3-4).

1. **Find the grid on both songs.** **madmom** listens to each track and marks
   every beat and every downbeat (bar-start). Now we know exactly where the
   "1"s are.
2. **Match the speed.** Pick a target BPM (default = the beat song's). Stretch
   the other track to that BPM with **Rubber Band** — a high-quality stretcher
   that changes *speed without changing pitch* (so the voice doesn't turn into
   a chipmunk). If the two tempos are very far apart (e.g. 80 vs 150), we
   halve/double one instead of a huge stretch, which keeps it clean.
3. **Snap the grids together.** Slide the vocal so its downbeats sit exactly on
   the beat song's downbeats. Same speed **and** same phase = locked in.

That's it — "beat matched" means *same BPM + downbeats aligned.*

## Matching the pitch (harmonic mixing, the easy way)

You don't need to read music. There's a cheat sheet called the **Camelot
wheel**: every key gets a code like `8A` or `5B`. The rule:

- **Same code** → perfect.
- **±1 number** (8A↔9A, 8A↔7A) → smooth.
- **Same number, swap letter** (8A↔8B) → smooth (relative major/minor).
- Anything else → likely to clash.

**Essentia** (doc 14, stage 3) detects each song's key and we convert to its
Camelot code. If the two songs aren't compatible, **Rubber Band** shifts one
by the *smallest* number of semitones needed to reach a compatible code —
smallest so the voice still sounds natural. This is the entire "make them
agree in pitch" step, done with a lookup table + one shift.

## Where to join (structure-aware, not random)

Joining at a random second sounds amateur. **allin1** (doc 14, stage 3) labels
each song's sections with timestamps — intro, verse, chorus, outro. We use
that map:

- **Blend during intros/outros** (usually beat-only, low energy — forgiving).
- **Land A's vocal chorus on B's chorus** (both high-energy → the payoff
  moment hits together).
- **Never** drop A's vocal on top of a spot where B still has its own vocal.

**Gemini** turns this map into an arrangement plan (doc 14, stage 5) so the
placement is *musical*, not mechanical.

## The transition toolbox (how the actual joins are made)

When we move from one part to another, we don't hard-cut (unless we want
impact). The standard, pro-sounding moves — all doable with **ffmpeg** and
**pedalboard**:

- **Crossfade** — fade one down while the other comes up. The everyday blend.
- **Bass swap / EQ blend** — never let two basslines overlap: cut the low end
  of the outgoing track and bring in the incoming bass exactly on a downbeat.
  Kills mud. This is the single biggest "sounds pro" trick.
- **Filter sweep** — slowly remove the lows (a "high-pass" opening up) to build
  tension into a drop, then release on the "1".
- **Hard cut on the downbeat** — for a punchy switch into a chorus.
- **Echo/reverb tail** — let the outgoing part ring out so the seam is smooth.

For v1 we automate **crossfade + bass swap + land on the downbeat**; the rest
are polish.

## Making a NEW beat (three options, pick per job)

"Make a new beat" can mean three different things — we support them as a
choice on the form:

1. **Use song B's beat as-is** (default mashup). The "new beat" under A's voice
   *is* B's instrumental. Simplest, most recognizable, zero generation cost.
2. **Generate a fresh beat with AI.** Ask **ACE-Step** (doc 14) for an original
   instrumental *at the target BPM and key* (e.g. "trap beat, 92 BPM, F minor")
   and put A's vocal (and optionally B's vocal) on top. Now both songs sing
   over a brand-new backing track. This is the most original result.
3. **Rebuild from loops.** Take a good 8-bar section of B's drums, loop it,
   layer B's bass and a bit of A's melody, and build a simple new arrangement
   on the grid. More control, more steps — a later milestone.

Because tempo and key are already locked by the earlier stages, *any* of the
three drops in without re-clashing.

## The full automated decision flow (what the system does, in order)

```
1. Split both songs into stems ............... Demucs
2. Detect grid + BPM on both ................. madmom (+ librosa check)
3. Detect key on both ........................ Essentia  →  Camelot code
4. Detect sections on both ................... allin1
5. Choose voice track + beat track ........... user's swap setting
6. Choose "new beat" mode (B-as-is / AI / loops)  user's setting
   └─ if AI: generate instrumental at target BPM+key .. ACE-Step
7. Stretch voice track to target BPM ......... Rubber Band (pitch preserved)
8. If keys incompatible, pitch-shift voice ... Rubber Band (smallest move)
9. Align voice downbeats to beat downbeats ... offset on the grid
10. Ask for an arrangement plan .............. Gemini (section map in/out)
11. Remove clashing layers ................... keep A-vocals + B-beat only
12. Join per plan: crossfade + bass swap ..... ffmpeg + pedalboard
13. Glue: light compression + reverb ......... pedalboard
14. Loudness normalize to ~-14 LUFS .......... pyloudnorm / ffmpeg loudnorm
15. Export WAV + MP3 (+ optional visualizer).. ffmpeg  → S3
```

Steps 1-4 are *listening*, 5-6 are *the user's choices*, 7-9 are *beat match*,
10-11 are *arrangement + cleanup*, 12-15 are *the actual join and finish*.

## What makes it sound pro vs. amateur (guardrails)

Cheap mashups fail in predictable ways; we guard against each:

- **Off-grid** (drift) → we align downbeats, not just BPM. *(step 9)*
- **Two basslines / mud** → bass swap; only one low end at a time. *(step 12)*
- **Sour pitch clash** → Camelot check + smallest-move shift. *(step 8)*
- **Robotic stretch artifacts** → Rubber Band, not a cheap phase vocoder;
  cap the shift to a few semitones. *(steps 7-8)*
- **Vocal-bleed from the stem split** → Demucs `htdemucs_ft` (cleaner) + a
  gentle high-pass on the vocal. *(steps 1, 13)*
- **Ugly seams** → join on phrase lines with crossfades, never mid-word. *(steps 10, 12)*
- **Uneven loudness** → normalize the master to one target. *(step 14)*

If all seven are handled, a non-musician can't tell it wasn't made by a DJ —
which is the whole goal.

## Next

Back to [14-audio-studio-mode.md](14-audio-studio-mode.md) for the app/queue
wiring, billing, and the build-order milestones. Build order still holds:
ship "B's beat as-is + BPM match + crossfade" first (steps 1-2, 5, 7, 9,
11-15), then add key matching, then AI arrangement, then generated/looped
beats.
