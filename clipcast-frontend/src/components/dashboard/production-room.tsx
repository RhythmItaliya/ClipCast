/**
 * Production Room — renders the AI production crew's decision trail for a job.
 * Entries are grouped by round; each shows which agent made a choice (from → to),
 * whether a real model or the deterministic fallback produced it, the chosen
 * parameters, and the model's rationale. Purely presentational (no state or
 * effects), so it stays a server component.
 */

import { ArrowRight, Clapperboard } from "lucide-react";
import type { ProductionLogEntry } from "~/types";

const ROLE_EMOJI: Record<string, string> = {
  "a&r": "🎧",
  lyricist: "✍️",
  director: "🎬",
  composer: "🎹",
  arranger: "🎛️",
  engineer: "🎚️",
  colorist: "🎨",
  writer: "📝",
  "story editor": "📖",
  critic: "🧐",
};

/** An RGB swatch when a decision carries {r,g,b} (the Colorist's dynamic pick). */
function ColorSwatch({ choices }: { choices: Record<string, unknown> }) {
  const { r, g, b } = choices as { r?: number; g?: number; b?: number };
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
    return null;
  }
  const hex = `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      <span
        className="border-border inline-block size-4 rounded-full border"
        style={{ backgroundColor: hex }}
      />
      {hex.toUpperCase()}
    </span>
  );
}

function choiceSummary(choices: Record<string, unknown>): string {
  return Object.entries(choices)
    .filter(([k]) => !["r", "g", "b"].includes(k))
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 260);
}

export function ProductionRoom({
  title,
  entries,
}: {
  title: string;
  entries: ProductionLogEntry[];
}) {
  if (entries.length === 0) {
    return (
      <div className="border-border bg-surface/40 grid place-items-center rounded-3xl border border-dashed px-6 py-16 text-center">
        <div className="bg-brand-soft text-brand grid size-12 place-items-center rounded-2xl">
          <Clapperboard className="size-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold">No production log</h3>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          This job ran before the AI production crew existed, or hasn&apos;t
          finished yet.
        </p>
      </div>
    );
  }

  // Distinct round numbers, ascending — the crew can re-run rounds (redo loop),
  // so we render each round as its own labelled group.
  const rounds = [...new Set(entries.map((e) => e.round))].sort((a, b) => a - b);

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="bg-brand-soft text-brand grid size-10 place-items-center rounded-2xl">
          <Clapperboard className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Production Room</h1>
          <p className="text-muted-foreground text-xs">
            How the AI crew decided <span className="text-foreground/70">{title}</span>
          </p>
        </div>
      </header>

      {rounds.map((round) => (
        <div key={round} className="space-y-3">
          {rounds.length > 1 && (
            <div className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
              Round {round}
            </div>
          )}
          {entries
            .filter((e) => e.round === round)
            .map((e, i) => (
              <div
                key={`${round}-${i}`}
                className="border-border bg-surface/40 rounded-2xl border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-background inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize">
                    <span>{ROLE_EMOJI[e.from.toLowerCase()] ?? "•"}</span>
                    {e.from}
                  </span>
                  {e.to && (
                    <>
                      <ArrowRight className="text-muted-foreground size-3.5" />
                      <span className="text-muted-foreground text-xs capitalize">
                        {e.to}
                      </span>
                    </>
                  )}
                  {/* WHO executed it — the real model, or the fallback. */}
                  {e.source === "llm" ? (
                    <span className="bg-brand-soft text-brand rounded-full px-2 py-0.5 text-[10px] font-medium">
                      {e.model ?? "model"}
                    </span>
                  ) : e.source === "fallback" ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
                      fallback
                    </span>
                  ) : null}
                  {typeof e.clip === "number" && (
                    <span className="text-muted-foreground ml-auto text-[11px]">
                      clip #{e.clip + 1}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <ColorSwatch choices={e.choices} />
                  <p className="text-foreground/80 text-sm">
                    {choiceSummary(e.choices) || "—"}
                  </p>
                </div>

                {e.rationale && e.rationale !== "fallback" && (
                  <p className="text-muted-foreground mt-1.5 text-xs italic">
                    “{e.rationale}”
                  </p>
                )}
                {e.error && (
                  <p className="text-destructive mt-1 text-xs">
                    ⚠ model failed → fallback: {e.error}
                  </p>
                )}
                {e.note && !e.error && (
                  <p className="text-muted-foreground mt-1 text-xs">↳ {e.note}</p>
                )}
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}
