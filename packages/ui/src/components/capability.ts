// Pure capability-gating logic for CircuitField's motion mode. Zero React
// import so this stays unit-testable without a DOM. "Measure, don't sniff":
// every signal here is a media query or a standard `navigator` property,
// never UA parsing. `navigator.deviceMemory` is deliberately not read —
// Chromium-only, non-standard.

export type MotionMode = "full" | "transitions-only" | "static";

export type CapabilitySignals = {
  reducedMotion: boolean;
  reducedData: boolean;
  coarsePointer: boolean;
  slowUpdate: boolean;
  hardwareConcurrency: number | undefined;
};

const MOTION_MODE_RANK: Record<MotionMode, number> = {
  static: 0,
  "transitions-only": 1,
  full: 2,
};

export function mostRestrictive(a: MotionMode, b: MotionMode): MotionMode {
  return MOTION_MODE_RANK[a] <= MOTION_MODE_RANK[b] ? a : b;
}

function matches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

export function readCapabilitySignals(): CapabilitySignals {
  if (typeof window === "undefined") {
    return {
      reducedMotion: false,
      reducedData: false,
      coarsePointer: false,
      slowUpdate: false,
      hardwareConcurrency: undefined,
    };
  }

  return {
    reducedMotion: matches("(prefers-reduced-motion: reduce)"),
    reducedData: matches("(prefers-reduced-data: reduce)"),
    coarsePointer: matches("(pointer: coarse)"),
    slowUpdate: matches("(update: slow)"),
    hardwareConcurrency:
      typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
        ? navigator.hardwareConcurrency
        : undefined,
  };
}

/**
 * Decision order, first match wins. `(pointer: coarse)` (not `any-pointer`)
 * is the confirmed mobile/low-power fallback — `pointer` reflects the
 * *primary* input, so a touchscreen laptop with a fine-pointer trackpad is
 * unaffected. `hardwareConcurrency: undefined` (Safari) falls through to
 * neutral rather than demoting — absence of a signal must never count as a
 * bad signal.
 */
export function decideMotionMode(signals: CapabilitySignals): MotionMode {
  if (signals.reducedMotion) return "static";
  if (signals.slowUpdate) return "static";
  if (signals.reducedData) return "static";
  if (signals.coarsePointer) return "static";

  const concurrency = signals.hardwareConcurrency;
  if (concurrency !== undefined) {
    if (concurrency <= 2) return "static";
    if (concurrency <= 4) return "transitions-only";
  }

  return "full";
}
