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

/**
 * Whether static mode's idle glow (a permanent ~3.2s compositor animation)
 * is safe to run given these signals — independent of *which* signal put
 * the device in `static`, since more than one can be true at once. `false`
 * whenever any accessibility- or performance-motivated signal is present
 * (reduced-motion, an e-ink-style slow panel, data-saver mode, or low
 * concurrency) — those devices are in `static` because animating is
 * expensive or unwanted, and the glow would be exactly that. `coarsePointer`
 * alone (a touch device with no other restrictive signal) is the one path
 * left eligible: it demotes for input-model reasons, not because the device
 * can't afford motion.
 */
export function canShowIdleGlow(signals: CapabilitySignals): boolean {
  if (signals.reducedMotion || signals.slowUpdate || signals.reducedData) return false;
  return signals.hardwareConcurrency === undefined || signals.hardwareConcurrency > 2;
}
