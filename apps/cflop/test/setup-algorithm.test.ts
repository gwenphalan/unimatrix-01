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
      caseFrequency: 1,
    };

    expect(chooseSetupAlgorithm(empty, "pll")).toBeUndefined();
  });

  it("falls back to the only algorithm a single-algorithm case has", () => {
    const single: AlgorithmCase = {
      algorithms: ["R U R' U R U2 R'"],
      displayName: "Sune",
      group: "Test",
      id: "sune",
      caseFrequency: 1,
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

  it("falls back to the primary when an alternate derives a different diagram", () => {
    // Written by hand rather than taken from the shipped data, which no longer exhibits it:
    // the generator AUF-aligns every alternate onto the primary's diagram before writing it,
    // so this filter rejects nothing there. It still guards what a future source could carry.
    const misaligned: AlgorithmCase = {
      algorithms: ["R U R' U R U2 R'", "U R U R' U R U2 R'"],
      displayName: "Sune",
      group: "Test",
      id: "sune",
      caseFrequency: 1,
    };

    expect(chooseSetupAlgorithm(misaligned, "oll")?.algorithmIndex).toBe(0);
  });

  it("falls back to the primary for the one shipped case with no alternate", () => {
    const choice = chooseSetupAlgorithm(pllCase("pll-e"), "pll");

    // Anchored on the algorithm count as well as the index: the data is regenerated rather
    // than hand-edited, so without this a dataset change reports a bare index mismatch.
    expect(pllCase("pll-e").algorithms).toHaveLength(1);
    expect(choice?.algorithmIndex).toBe(0);
  });

  it("prefers a valid alternate over reversing the algorithm on screen", () => {
    const choice = chooseSetupAlgorithm(pllCase("pll-ua"), "pll");

    expect(pllCase("pll-ua").algorithms.length).toBeGreaterThan(1);
    expect(choice?.algorithmIndex).not.toBe(0);
  });
});
