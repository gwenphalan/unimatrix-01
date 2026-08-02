export const ALGORITHM_SET_IDS = ["oll", "pll"] as const;

export type AlgorithmSetId = (typeof ALGORITHM_SET_IDS)[number];

export interface AlgorithmCase {
  id: string;
  displayName: string;
  group: string;
  algorithms: string[];
  /** Read only by `orderedLearnCases`, as a sort key; Drill draws uniformly. */
  caseFrequency: number;
}

export interface AlgorithmSet {
  id: AlgorithmSetId;
  label: string;
  description: string;
  groupOrder: string[];
  cases: AlgorithmCase[];
}

export interface CaseGroup {
  group: string;
  cases: AlgorithmCase[];
}
