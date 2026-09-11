"use client";

import { Activity, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { testService } from "~/actions/health";
import {
  SERVICE_GROUPS,
  type ServiceStatus,
  type ServiceTestResult,
} from "~/lib/services";

type Cell = { state: "idle" | "testing" | "done"; result?: ServiceTestResult };

/** Admin service-health dashboard: config status for every dependency plus
 * on-demand "Test connection" probes. */
export function ServiceHealthPanel({ statuses }: { statuses: ServiceStatus[] }) {
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [testingAll, setTestingAll] = useState(false);

  const runTest = async (id: string) => {
    setCells((c) => ({ ...c, [id]: { state: "testing" } }));
    try {
      const result = await testService(id);
      setCells((c) => ({ ...c, [id]: { state: "done", result } }));
    } catch {
      setCells((c) => ({
        ...c,
        [id]: {
          state: "done",
          result: { ok: false, detail: "Request failed.", latencyMs: 0 },
        },
      }));
    }
  };

  const testAll = async () => {
    setTestingAll(true);
    await Promise.all(
      statuses.filter((s) => s.configured).map((s) => runTest(s.id)),
    );
    setTestingAll(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          Config status is shown live. Use Test to probe a service&apos;s real
          connection.
        </p>
        <button
          onClick={testAll}
          disabled={testingAll}
          className="border-border hover:bg-surface-2 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60"
        >
          {testingAll ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Activity className="size-3.5" />
          )}
          Test all configured
        </button>
      </div>

      {SERVICE_GROUPS.map((group) => {
        const rows = statuses.filter((s) => s.group === group);
        if (rows.length === 0) return null;
        return (
          <div
            key={group}
            className="border-border bg-surface/40 rounded-3xl border p-5"
          >
            <h3 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
              {group}
            </h3>
            <div className="mt-3 space-y-2">
              {rows.map((s) => {
                const cell = cells[s.id] ?? { state: "idle" as const };
                return (
                  <div
                    key={s.id}
                    className="border-border bg-background rounded-2xl border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      {s.configured ? (
                        <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                          Configured
                        </span>
                      ) : (
                        <span className="text-muted-foreground bg-surface-2 rounded-full px-2 py-0.5 text-[11px] font-medium">
                          Not configured
                        </span>
                      )}
                      <button
                        onClick={() => runTest(s.id)}
                        disabled={cell.state === "testing"}
                        className="border-border hover:bg-surface-2 ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60"
                      >
                        {cell.state === "testing" ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Activity className="size-3" />
                        )}
                        Test
                      </button>
                    </div>

                    <p className="text-muted-foreground mt-1 text-xs">
                      {s.description}
                      {s.note ? ` — ${s.note}` : ""}
                    </p>

                    {cell.state === "done" && cell.result && (
                      <div
                        className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
                          cell.result.ok
                            ? "text-green-600 dark:text-green-400"
                            : "text-destructive"
                        }`}
                      >
                        {cell.result.ok ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : (
                          <XCircle className="size-3.5" />
                        )}
                        <span>{cell.result.detail}</span>
                        {cell.result.latencyMs > 0 && (
                          <span className="text-muted-foreground">
                            ({cell.result.latencyMs} ms)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
