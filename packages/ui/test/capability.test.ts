import { describe, expect, it } from "vitest";

import { type CapabilitySignals, canShowIdleGlow, decideMotionMode, mostRestrictive } from "../src/components/capability.js";

const NEUTRAL: CapabilitySignals = {
  reducedMotion: false,
  reducedData: false,
  coarsePointer: false,
  slowUpdate: false,
  hardwareConcurrency: 8,
};

describe("decideMotionMode", () => {
  it("returns full when every signal is neutral and concurrency is high", () => {
    expect(decideMotionMode(NEUTRAL)).toBe("full");
  });

  it("prefers-reduced-motion alone forces static", () => {
    expect(decideMotionMode({ ...NEUTRAL, reducedMotion: true })).toBe("static");
  });

  it("(update: slow) alone forces static", () => {
    expect(decideMotionMode({ ...NEUTRAL, slowUpdate: true })).toBe("static");
  });

  it("prefers-reduced-data alone forces static", () => {
    expect(decideMotionMode({ ...NEUTRAL, reducedData: true })).toBe("static");
  });

  it("(pointer: coarse) alone forces static, regardless of concurrency", () => {
    expect(decideMotionMode({ ...NEUTRAL, coarsePointer: true, hardwareConcurrency: 8 })).toBe("static");
  });

  it("low hardwareConcurrency (<=2) forces static", () => {
    expect(decideMotionMode({ ...NEUTRAL, hardwareConcurrency: 2 })).toBe("static");
    expect(decideMotionMode({ ...NEUTRAL, hardwareConcurrency: 1 })).toBe("static");
  });

  it("mid hardwareConcurrency (3-4) yields transitions-only", () => {
    expect(decideMotionMode({ ...NEUTRAL, hardwareConcurrency: 3 })).toBe("transitions-only");
    expect(decideMotionMode({ ...NEUTRAL, hardwareConcurrency: 4 })).toBe("transitions-only");
  });

  it("high hardwareConcurrency (>4) yields full", () => {
    expect(decideMotionMode({ ...NEUTRAL, hardwareConcurrency: 5 })).toBe("full");
  });

  it("undefined hardwareConcurrency (Safari) does not demote on its own", () => {
    expect(decideMotionMode({ ...NEUTRAL, hardwareConcurrency: undefined })).toBe("full");
  });

  it("undefined hardwareConcurrency still yields static/transitions-only when another signal demotes", () => {
    expect(decideMotionMode({ ...NEUTRAL, hardwareConcurrency: undefined, reducedMotion: true })).toBe("static");
  });
});

describe("canShowIdleGlow", () => {
  it("a coarse-pointer-only static device (touch, otherwise capable) is eligible", () => {
    expect(canShowIdleGlow({ ...NEUTRAL, coarsePointer: true, hardwareConcurrency: 8 })).toBe(true);
  });

  it("undefined hardwareConcurrency (Safari) does not disqualify it on its own", () => {
    expect(canShowIdleGlow({ ...NEUTRAL, coarsePointer: true, hardwareConcurrency: undefined })).toBe(true);
  });

  it("reduced-motion disqualifies it", () => {
    expect(canShowIdleGlow({ ...NEUTRAL, reducedMotion: true })).toBe(false);
  });

  it("(update: slow) disqualifies it", () => {
    expect(canShowIdleGlow({ ...NEUTRAL, slowUpdate: true })).toBe(false);
  });

  it("prefers-reduced-data disqualifies it", () => {
    expect(canShowIdleGlow({ ...NEUTRAL, reducedData: true })).toBe(false);
  });

  it("low hardwareConcurrency (<=2) disqualifies it, even alongside coarsePointer", () => {
    expect(canShowIdleGlow({ ...NEUTRAL, coarsePointer: true, hardwareConcurrency: 2 })).toBe(false);
  });
});

describe("mostRestrictive", () => {
  it("static beats everything", () => {
    expect(mostRestrictive("static", "full")).toBe("static");
    expect(mostRestrictive("full", "static")).toBe("static");
    expect(mostRestrictive("static", "transitions-only")).toBe("static");
  });

  it("transitions-only beats full", () => {
    expect(mostRestrictive("transitions-only", "full")).toBe("transitions-only");
    expect(mostRestrictive("full", "transitions-only")).toBe("transitions-only");
  });

  it("full vs full stays full", () => {
    expect(mostRestrictive("full", "full")).toBe("full");
  });
});
