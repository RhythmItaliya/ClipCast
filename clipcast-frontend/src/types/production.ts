/** One entry in a job's multi-agent production transcript (docs/17). Mirrors
 * the backend crew's `ProductionLog.to_json()` shape. */
export type ProductionLogEntry = {
  round: number;
  from: string;
  to: string | null;
  choices: Record<string, unknown>;
  rationale: string;
  note: string;
  ts: number;
  /** Present on clip-crew entries: which clip index this decision was for. */
  clip?: number;
};

export type ProductionLog = {
  title: string;
  entries: ProductionLogEntry[];
};
