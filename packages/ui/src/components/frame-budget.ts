// Pure frame-budget probe for CircuitField's boot-time watchdog. Zero React
// import. Fed `performance.now()`-style timestamps from a dedicated,
// self-cancelling rAF loop (see circuit-field.tsx) — never from the
// transition loop, which only runs while something is actually crawling and
// would starve the probe of samples during a static-content boot.

export type FrameBudgetVerdict = "pending" | "ok" | "over";

export type FrameBudgetProbeOptions = {
  /** Post-warmup frame deltas required before a verdict is reached. */
  samples?: number;
  /** Leading deltas discarded — first-paint/mount noise. */
  warmupSamples?: number;
};

const DEFAULT_SAMPLES = 40;
const DEFAULT_WARMUP_SAMPLES = 3;
// A delta this large is treated as a tab-switch/gap artifact, not a slow
// frame, so an isolated one (a genuine hide/show cycle mid-sampling) can't
// wrongly trip the verdict. But a device rendering below ~4fps produces
// deltas past this on *every* frame — left unbounded, `deltas` would never
// fill and the verdict would stay `pending` forever on precisely the
// worst-performing devices. `MAX_CONSECUTIVE_OUTLIERS` bounds that: enough
// consecutive over-threshold deltas resolves straight to `over` instead.
const GAP_OUTLIER_MS = 250;
const MAX_CONSECUTIVE_OUTLIERS = 5;
// Ratio of frames whose delta exceeds 1.75x the observed best frame.
const DROPPED_FRAME_RATIO_THRESHOLD = 0.4;
const DROPPED_FRAME_MULTIPLIER = 1.75;
// A device whose *best* frame during boot is slower than this is uniformly
// slow — the ratio arm alone would score it zero dropped frames.
const SLOW_BASELINE_MS = 40;

export function createFrameBudgetProbe(options: FrameBudgetProbeOptions = {}): {
  record(timestampMs: number): FrameBudgetVerdict;
} {
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const warmupSamples = options.warmupSamples ?? DEFAULT_WARMUP_SAMPLES;

  let prevTimestamp: number | null = null;
  let seen = 0;
  let consecutiveOutliers = 0;
  const deltas: number[] = [];
  let verdict: FrameBudgetVerdict = "pending";

  return {
    record(timestampMs: number): FrameBudgetVerdict {
      if (verdict !== "pending") return verdict;

      if (prevTimestamp === null) {
        prevTimestamp = timestampMs;
        return "pending";
      }

      const delta = timestampMs - prevTimestamp;
      prevTimestamp = timestampMs;

      if (delta > GAP_OUTLIER_MS) {
        consecutiveOutliers += 1;
        if (consecutiveOutliers >= MAX_CONSECUTIVE_OUTLIERS) {
          verdict = "over";
          return verdict;
        }
        return "pending";
      }
      consecutiveOutliers = 0;

      seen += 1;
      if (seen <= warmupSamples) return "pending";

      deltas.push(delta);
      if (deltas.length < samples) return "pending";

      const baseline = Math.min(...deltas);
      const dropped = deltas.filter((d) => d > DROPPED_FRAME_MULTIPLIER * baseline).length;
      verdict =
        dropped / samples > DROPPED_FRAME_RATIO_THRESHOLD || baseline > SLOW_BASELINE_MS
          ? "over"
          : "ok";
      return verdict;
    },
  };
}
