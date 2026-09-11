/**
 * Audio Studio — interactive client form for the two music-production modes.
 * "AI Mix" combines up to 6 YouTube links / uploaded audio files into a
 * beat-matched, hook-detected clip; "Compose" generates an original track from
 * a text prompt. Both submit to server actions in ~/actions/audio and drop the
 * job into the processing queue.
 */
"use client"; // stateful form + client-side S3 uploads → must run in the browser

import {
  ChevronDown,
  Link2,
  Music2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  createAdvancedMix,
  createGeneratedTrack,
  generateAudioSourceUploadUrl,
  type AudioSourceInput,
  type AudioSourceRole,
  type MixTransformStrength,
} from "~/actions/audio";

// ─── Constants ───────────────────────────────────────────────────────────────

const GENRES = [
  "auto",
  "lofi",
  "ambient",
  "cinematic",
  "trap",
  "house",
  "pop",
  "bollywood",
  "rock",
] as const;

type Genre = (typeof GENRES)[number];

const GENRE_LABELS: Record<Genre, string> = {
  auto: "Auto (match the songs)",
  lofi: "Lo-fi",
  ambient: "Ambient",
  cinematic: "Cinematic",
  trap: "Trap",
  house: "House",
  pop: "Pop",
  bollywood: "Bollywood",
  rock: "Rock",
};

const TRANSFORM_LABELS: Record<MixTransformStrength, string> = {
  auto: "Auto decide",
  clean: "Clean mix",
  subtle: "Subtle update",
  transformed: "Transformed",
  max: "Max change",
};

const DURATION_OPTIONS = [
  { value: "auto", label: "Auto (AI decides)" },
  { value: "15", label: "15 seconds" },
  { value: "20", label: "20 seconds" },
  { value: "30", label: "30 seconds" },
  { value: "45", label: "45 seconds" },
  { value: "59", label: "59 seconds (max)" },
] as const;

const ROLE_OPTIONS: { value: AudioSourceRole; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "vocal", label: "Vocal" },
  { value: "bed", label: "Bed" },
  { value: "extra", label: "Extra" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type LocalSource = {
  localId: string;
  kind: "youtube" | "s3";
  role: AudioSourceRole;
  label: string;
  url: string;
  file?: File;
  s3Key?: string;
};

// Builds a blank source row with a stable local id (used as the React key).
// Falls back to a timestamp id where crypto.randomUUID is unavailable.
function newSource(kind: "youtube" | "s3" = "youtube"): LocalSource {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return {
    localId: id,
    kind,
    role: "auto",
    label: kind === "youtube" ? "YouTube source" : "Audio file",
    url: "",
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AudioStudioClient() {
  const router = useRouter();
  // useTransition keeps the form responsive while the submit server action runs;
  // `uploading` covers the separate step of pushing local files to S3 first.
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState<Genre>("auto");
  const [mixGenre, setMixGenre] = useState<Genre>("auto");
  const [transformStrength, setTransformStrength] =
    useState<MixTransformStrength>("auto");
  const [remixDuration, setRemixDuration] = useState("auto");
  const [sources, setSources] = useState<LocalSource[]>([
    { ...newSource("youtube"), role: "auto", label: "Song A (X)" },
    { ...newSource("youtube"), role: "auto", label: "Song B (ABC)" },
  ]);
  const [activeTab, setActiveTab] = useState<"mix" | "generate">("mix");

  function updateSource(localId: string, patch: Partial<LocalSource>) {
    setSources((current) =>
      current.map((source) =>
        source.localId === localId ? { ...source, ...patch } : source,
      ),
    );
  }

  function addSource(kind: "youtube" | "s3") {
    if (sources.length >= 6) {
      toast.error("Use up to 6 sources in one mix.");
      return;
    }
    setSources((current) => [...current, newSource(kind)]);
  }

  function removeSource(localId: string) {
    setSources((current) =>
      current.length > 1
        ? current.filter((source) => source.localId !== localId)
        : current,
    );
  }

  function handleResult(result: { success: boolean; error?: string }) {
    if (result.success) {
      toast.success("Added to your queue. We'll email you when it's ready.");
      setPrompt("");
      router.push("/dashboard/queue");
    } else {
      toast.error(result.error ?? "Something went wrong. Please try again.");
    }
  }

  // Normalizes the local source rows into the server action's input shape.
  // YouTube rows pass their URL through; file rows are uploaded straight to S3
  // via a presigned PUT (skipped if already uploaded) and pass their S3 key.
  async function prepareMixSources(): Promise<AudioSourceInput[]> {
    const prepared: AudioSourceInput[] = [];
    for (const source of sources) {
      if (source.kind === "youtube") {
        if (!source.url.trim()) continue;
        prepared.push({
          kind: "youtube",
          url: source.url.trim(),
          role: source.role,
          label: source.label,
        });
        continue;
      }

      let s3Key = source.s3Key;
      if (!s3Key && source.file) {
        const upload = await generateAudioSourceUploadUrl({
          filename: source.file.name,
          contentType: source.file.type || "audio/mpeg",
          size: source.file.size,
        });
        if (!upload.success) throw new Error(upload.error);
        const response = await fetch(upload.signedUrl, {
          method: "PUT",
          body: source.file,
          headers: { "Content-Type": source.file.type || "audio/mpeg" },
        });
        if (!response.ok) {
          throw new Error("Could not upload one audio file. Please try again.");
        }
        s3Key = upload.key;
        updateSource(source.localId, { s3Key });
      }
      if (!s3Key) continue;
      prepared.push({
        kind: "s3",
        s3Key,
        role: source.role,
        label: source.file?.name ?? source.label,
      });
    }
    return prepared;
  }

  function submitMix() {
    startTransition(async () => {
      try {
        setUploading(true);
        const prepared = await prepareMixSources();
        handleResult(
          await createAdvancedMix(
            prepared,
            transformStrength,
            remixDuration === "auto" ? 0 : Number(remixDuration),
            mixGenre,
          ),
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not start mix.",
        );
      } finally {
        setUploading(false);
      }
    });
  }

  function submitGenerate() {
    startTransition(async () =>
      handleResult(await createGeneratedTrack(prompt, genre)),
    );
  }

  const hasMixInput = sources.some((source) =>
    source.kind === "youtube" ? source.url.trim() : source.file || source.s3Key,
  );

  const isBusy = pending || uploading;

  return (
    <div className="space-y-5">
      {/* Hero banner — mirrors the Overview hero style */}
      <section className="border-border from-brand/20 via-brand/5 relative overflow-hidden rounded-3xl border bg-gradient-to-br to-transparent p-5">
        <div className="bg-brand/15 absolute -top-10 -right-10 size-52 rounded-full blur-3xl" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-brand flex items-center gap-2 text-xs font-medium">
              <Sparkles className="size-3.5" />
              AUDIO STUDIO
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              Mix two songs into a viral hook, or compose from scratch.
            </h2>
            <p className="text-muted-foreground text-sm">
              Stem-separated, beat-matched, hook-detected — all in one queue
              job.
            </p>
          </div>
          {/* Animated waveform decoration */}
          <div className="flex shrink-0 items-end gap-[3px] self-end sm:self-auto">
            {[0.4, 0.7, 1, 0.6, 0.85, 0.5, 0.9, 0.3, 0.75, 0.55, 0.95, 0.4].map(
              (h, i) => (
                <span
                  key={i}
                  className="wave-bar bg-brand/40 w-1.5 rounded-full"
                  style={{
                    height: `${Math.round(h * 36)}px`,
                    animationDelay: `${(i * 0.12).toFixed(2)}s`,
                  }}
                />
              ),
            )}
          </div>
        </div>
      </section>

      {/* Tab switcher — same pill pattern as uploader clip-mode row */}
      <div className="border-border bg-background flex gap-1 overflow-x-auto self-start rounded-full border p-1 w-fit">
        <TabPill
          active={activeTab === "mix"}
          onClick={() => setActiveTab("mix")}
          icon={<Music2 className="size-3.5" />}
        >
          AI Mix
        </TabPill>
        <TabPill
          active={activeTab === "generate"}
          onClick={() => setActiveTab("generate")}
          icon={<Wand2 className="size-3.5" />}
        >
          Compose
        </TabPill>
      </div>

      {/* ── Mix tab ──────────────────────────────────────────────────────────── */}
      {activeTab === "mix" && (
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          {/* Left — sources */}
          <div className="border-border bg-surface/60 overflow-hidden rounded-3xl border">
            {/* Panel header */}
            <div className="border-border border-b px-5 py-4">
              <div className="text-muted-foreground flex items-center gap-2 text-[10px] font-semibold tracking-widest uppercase">
                <Music2 className="size-3.5" />
                Source tracks
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Add up to 6 sources — YouTube links or local audio files. We
                extract every stem, find the catchiest hooks, and combine them.
              </p>
            </div>

            <div className="space-y-3 p-5">
              {sources.map((source, index) => (
                <SourceRow
                  key={source.localId}
                  source={source}
                  index={index}
                  canRemove={sources.length > 1}
                  isBusy={isBusy}
                  onUpdate={(patch) => updateSource(source.localId, patch)}
                  onRemove={() => removeSource(source.localId)}
                />
              ))}

              {/* Add source buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => addSource("youtube")}
                  disabled={isBusy || sources.length >= 6}
                  className="border-border hover:bg-surface-2 flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  <Plus className="size-3.5" /> Add YouTube
                </button>
                <button
                  type="button"
                  onClick={() => addSource("s3")}
                  disabled={isBusy || sources.length >= 6}
                  className="border-border hover:bg-surface-2 flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  <Upload className="size-3.5" /> Add audio file
                </button>
              </div>
            </div>
          </div>

          {/* Right — mix settings */}
          <div className="space-y-4">
            <SettingsCard label="Target genre">
              <StyledSelect
                id="mix-genre"
                value={mixGenre}
                onChange={(v) => setMixGenre(v as Genre)}
                options={GENRES.map((g) => ({ value: g, label: GENRE_LABELS[g] }))}
              />
              <p className="text-muted-foreground text-xs">
                Convert the hook into this style. Auto keeps the source genre.
              </p>
            </SettingsCard>

            <SettingsCard label="Beat originality">
              <StyledSelect
                id="transform-strength"
                value={transformStrength}
                onChange={(v) => setTransformStrength(v as MixTransformStrength)}
                options={(
                  ["auto", "clean", "subtle", "transformed", "max"] as MixTransformStrength[]
                ).map((v) => ({ value: v, label: TRANSFORM_LABELS[v] }))}
              />
            </SettingsCard>

            <SettingsCard label="Viral clip length">
              <StyledSelect
                id="remix-duration"
                value={remixDuration}
                onChange={setRemixDuration}
                options={DURATION_OPTIONS.map((d) => ({
                  value: d.value,
                  label: d.label,
                }))}
              />
            </SettingsCard>

            {/* Submit */}
            <button
              onClick={submitMix}
              disabled={isBusy || !hasMixInput}
              className="bg-brand text-brand-foreground flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Sparkles className="size-4" />
              {isBusy ? "Adding to queue…" : "Create AI mix"}
            </button>
          </div>
        </section>
      )}

      {/* ── Generate tab ─────────────────────────────────────────────────────── */}
      {activeTab === "generate" && (
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          {/* Left — prompt */}
          <div className="border-border bg-surface/60 overflow-hidden rounded-3xl border">
            <div className="border-border border-b px-5 py-4">
              <div className="text-muted-foreground flex items-center gap-2 text-[10px] font-semibold tracking-widest uppercase">
                <Wand2 className="size-3.5" />
                Compose a track
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Gemini shapes the producer prompt, then the music model renders
                the track and the audio rater checks the master.
              </p>
            </div>

            <div className="p-5 space-y-4">
              {/* Song idea */}
              <div className="space-y-2">
                <label
                  htmlFor="prompt"
                  className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase"
                >
                  Song idea
                </label>
                {/* Textarea-style drop zone */}
                <div className="border-border bg-background/50 rounded-2xl border-2 border-dashed p-1">
                  <textarea
                    id="prompt"
                    rows={4}
                    placeholder="Hindi × English dance-pop hook with tabla, warm bass, glossy chorus…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={isBusy}
                    className="bg-transparent w-full resize-none px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  Be as descriptive as you like — instruments, mood, BPM, language.
                </p>
              </div>
            </div>
          </div>

          {/* Right — genre + submit */}
          <div className="space-y-4">
            <SettingsCard label="Genre">
              <StyledSelect
                id="genre"
                value={genre}
                onChange={(v) => setGenre(v as Genre)}
                options={GENRES.map((g) => ({ value: g, label: GENRE_LABELS[g] }))}
              />
            </SettingsCard>

            <button
              onClick={submitGenerate}
              disabled={isBusy || (!prompt.trim() && !genre)}
              className="bg-brand text-brand-foreground flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Wand2 className="size-4" />
              {isBusy ? "Adding to queue…" : "Compose track"}
            </button>

            {/* Info card */}
            <div className="border-border bg-surface/60 rounded-3xl border p-4 space-y-2">
              <div className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
                How it works
              </div>
              {[
                "Gemini crafts a production brief from your idea",
                "Music model renders a full-quality master",
                "AI rater checks mix quality and retries if needed",
                "Track lands in your Library when done",
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="bg-brand-soft text-brand mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold">
                    {i + 1}
                  </div>
                  <p className="text-muted-foreground text-xs">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabPill({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-brand text-brand-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function SettingsCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border bg-surface/60 rounded-3xl border p-4 space-y-2">
      <div className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

// Native <select> styled to match the design system: appearance-none hides the
// browser's default arrow, replaced by a lucide ChevronDown layered on top.
function StyledSelect({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-border bg-background focus:ring-brand/50 w-full appearance-none rounded-xl border px-3 py-2.5 pr-8 text-sm outline-none focus:ring-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
    </div>
  );
}

// One source row in the AI Mix panel: switch between a YouTube URL and a local
// file upload, choose the stem role, or remove the row.
function SourceRow({
  source,
  index,
  canRemove,
  isBusy,
  onUpdate,
  onRemove,
}: {
  source: LocalSource;
  index: number;
  canRemove: boolean;
  isBusy: boolean;
  onUpdate: (patch: Partial<LocalSource>) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border-border bg-background/50 hover:bg-background rounded-2xl border p-4 transition-colors">
      {/* Row header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-brand-soft text-brand grid size-7 shrink-0 place-items-center rounded-lg">
            <Music2 className="size-3.5" />
          </div>
          <span className="text-xs font-semibold">
            Source {index + 1}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Kind toggle pills */}
          <div className="border-border bg-surface flex gap-1 rounded-full border p-0.5">
            <button
              type="button"
              onClick={() =>
                onUpdate({ kind: "youtube", url: "", file: undefined, s3Key: undefined })
              }
              disabled={isBusy}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                source.kind === "youtube"
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              YouTube
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdate({ kind: "s3", url: "", file: undefined, s3Key: undefined })
              }
              disabled={isBusy}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                source.kind === "s3"
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              File
            </button>
          </div>

          {/* Role select */}
          <div className="relative">
            <select
              value={source.role}
              onChange={(e) => onUpdate({ role: e.target.value as AudioSourceRole })}
              disabled={isBusy}
              className="border-border bg-surface appearance-none rounded-full border py-1 pl-3 pr-6 text-[10px] font-medium outline-none"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2" />
          </div>

          {/* Remove */}
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove || isBusy}
            aria-label="Remove source"
            className="text-muted-foreground hover:text-destructive disabled:opacity-30 grid size-7 place-items-center rounded-lg transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Input */}
      {source.kind === "youtube" ? (
        <div className="relative">
          <Link2 className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            type="url"
            placeholder="https://youtube.com/watch?v=…"
            value={source.url}
            onChange={(e) => onUpdate({ url: e.target.value })}
            disabled={isBusy}
            className="border-border bg-background focus:ring-brand/50 w-full rounded-xl border py-2.5 pr-4 pl-9 text-sm outline-none focus:ring-2 disabled:opacity-50"
          />
        </div>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/flac,audio/ogg"
            className="hidden"
            disabled={isBusy}
            onChange={(e) =>
              onUpdate({ file: e.target.files?.[0], s3Key: undefined })
            }
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className={`border-border w-full rounded-xl border-2 border-dashed py-3 text-center text-sm transition-colors hover:border-brand/50 ${
              source.file ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {source.file ? (
              <span className="font-medium">{source.file.name}</span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Upload className="size-4" /> Choose audio file
              </span>
            )}
          </button>
        </>
      )}
    </div>
  );
}
