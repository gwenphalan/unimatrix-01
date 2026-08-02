import { describe, expect, it } from "vitest";

import { getAlgorithmSet } from "@/features/algorithms/algorithm-sets";
import type { AlgorithmCase } from "@/features/algorithms/types";
import { chooseSetupAlgorithm } from "@/features/trainer/setup-algorithm";

function pllCase(id: string): AlgorithmCase {
  const found = getAlgorithmSet("pll").cases.find((algorithmCase) => algorithmCase.id === id);
  if (!found) throw new Error(`Missing expected PLL case: ${id}`);
  return found;
}

describe("chooseSetupAlgorithm", () => {
  it("returns undefined only for a case with no algorithms", () => {
    const empty: AlgorithmCase = {
      algorithms: [],
      displayName: "Empty",
      group: "Test",
      id: "empty",
      probabilityWeight: 1,
    };

    expect(chooseSetupAlgorithm(empty, "pll")).toBeUndefined();
  });

  it("falls back to the only algorithm a single-algorithm case has", () => {
    const single: AlgorithmCase = {
      algorithms: ["R U R' U R U2 R'"],
      displayName: "Sune",
      group: "Test",
      id: "sune",
      probabilityWeight: 1,
    };

    expect(chooseSetupAlgorithm(single, "oll")?.algorithmIndex).toBe(0);
  });

  it("is pure, so two calls for the same case agree", () => {
    // The consuming `useMemo`s re-run under StrictMode's double invocation - anything random
    // or time-dependent here would render two different scrambles for one case.
    const first = chooseSetupAlgorithm(pllCase("pll-ua"), "pll");
    const second = chooseSetupAlgorithm(pllCase("pll-ua"), "pll");

    expect(first).toEqual(second);
  });

  it("falls back to the primary when every alternate derives a different diagram", () => {
    // pll-ja's two alternates each derive a different diagram from the primary's, so the
    // filter empties and index 0 - which defines the target - is all that is left. Both do
    // pass `cube-engine.test.ts`'s alternate check, which is not a contradiction: that check
    // allows a leading or trailing AUF turn and this filter compares the diagrams as drawn.
    const choice = chooseSetupAlgorithm(pllCase("pll-ja"), "pll");

    expect(pllCase("pll-ja").algorithms).toHaveLength(3);
    expect(choice?.algorithmIndex).toBe(0);
  });

  it("prefers a valid alternate over reversing the algorithm on screen", () => {
    const choice = chooseSetupAlgorithm(pllCase("pll-ua"), "pll");

    expect(choice?.algorithmIndex).not.toBe(0);
  });
});
