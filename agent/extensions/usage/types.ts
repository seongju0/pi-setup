export type Period = "week" | "month";

export interface Totals {
  records: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** Subset of output; null when no record supplies a reasoning counter. */
  reasoning: number | null;
  /** Sum of known recorded catalog estimates, never a provider invoice. */
  cost: number;
  unpriced: number;
}

export interface ModelTotals extends Totals {
  provider: string;
  model: string;
}

export interface ProviderTotals extends Totals {
  key: "codex" | "anthropic" | "other" | "unattributed";
  label: string;
  models: ModelTotals[];
}

export interface UsageReport {
  period: Period;
  start: Date;
  end: Date;
  refreshedAt: Date;
  monthlyFee: number;
  rows: ProviderTotals[];
  /** Plain-text coverage notes; never transcript content or file paths. */
  coverage: string[];
}
