import { describe, expect, it } from "vitest";

import { getAlgorithmSet, groupCasesByGroup } from "@/features/algorithms/algorithm-sets";
import { selectionChanges, summarizeSelection } from "@/features/algorithms/case-selection";

const groupedCases = groupCasesByGroup(getAlgorithmSet("pll"));
const [firstGroup] = groupedCases;

if (!firstGroup || firstGroup.cases.length < 2) {
  throw new Error("The first PLL group needs several cases for these tests to mean anything.");
}

const [firstCase] = firstGroup.cases as [(typeof firstGroup.cases)[number]];

describe("summarizeSelection", () => {
  it("counts every case as enabled when the pool is empty", () => {
    // An absent entry means enabled - see `isCaseEnabled`.
    const summary = summarizeSelection(groupedCases, {});

    expect(summary).toHaveLength(groupedCases.length);
    for (const { enabled, total } of summary) {
      expect(enabled).toBe(total);
    }
  });

  it("counts only the cases still in the pool", () => {
    const summary = summarizeSelection(groupedCases, { [firstCase.id]: false });
    const first = summary[0];

    expect(first?.group).toBe(firstGroup.group);
    expect(first?.enabled).toBe(firstGroup.cases.length - 1);
    expect(first?.total).toBe(firstGroup.cases.length);
  });
});

describe("selectionChanges", () => {
  it("writes an explicit entry for every case, both ways", () => {
    const enableAll = selectionChanges(firstGroup.cases, () => true);
    const disableAll = selectionChanges(firstGroup.cases, () => false);

    expect(Object.keys(enableAll)).toEqual(firstGroup.cases.map(({ id }) => id));
    expect(Object.values(enableAll).every(Boolean)).toBe(true);
    // Explicit `false` rather than an omitted key: an absent entry reads back as enabled.
    expect(Object.values(disableAll).some(Boolean)).toBe(false);
  });

  it("splits a set by the predicate, so one write both enables and disables", () => {
    const changes = selectionChanges(
      firstGroup.cases,
      (algorithmCase) => algorithmCase.id === firstCase.id,
    );

    expect(changes[firstCase.id]).toBe(true);
    expect(Object.values(changes).filter(Boolean)).toHaveLength(1);
  });
});
