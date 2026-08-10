import { useCallback, useState } from "react";

import type { AlgorithmSetId } from "@/features/algorithms/types";
import {
  type CasePool,
  clearDrillPoolMode,
  enableOnlyLearnedCases,
  readCasePool,
  readDrillPoolMode,
  setCaseEnabled,
  setCasesEnabled,
} from "@/lib/pool-storage";

export interface UseCasePoolResult {
  pool: CasePool;
  /** Whether the only-learned mode is on for this set; see `enableOnlyLearned`. */
  onlyLearned: boolean;
  setEnabled: (caseId: string, enabled: boolean) => void;
  /** Applies a whole id -> enabled record at once; see `setCasesEnabled`. */
  setManyEnabled: (changes: Readonly<Record<string, boolean>>) => void;
  /** Applies `changes` and turns the only-learned mode on; see `enableOnlyLearnedCases`. */
  enableOnlyLearned: (changes: Readonly<Record<string, boolean>>) => void;
  /** Turns the only-learned mode off without touching the pool. */
  clearOnlyLearned: () => void;
}

export function useCasePool(setId: AlgorithmSetId): UseCasePoolResult {
  const [pool, setPool] = useState<CasePool>(() => readCasePool(setId));
  const [onlyLearned, setOnlyLearned] = useState<boolean>(
    () => readDrillPoolMode(setId) === "only-learned",
  );

  const setEnabled = useCallback(
    (caseId: string, enabled: boolean) => {
      setPool(setCaseEnabled(setId, caseId, enabled));
      setOnlyLearned(false);
    },
    [setId],
  );

  const setManyEnabled = useCallback(
    (changes: Readonly<Record<string, boolean>>) => {
      setPool(setCasesEnabled(setId, changes));
      setOnlyLearned(false);
    },
    [setId],
  );

  const enableOnlyLearned = useCallback(
    (changes: Readonly<Record<string, boolean>>) => {
      setPool(enableOnlyLearnedCases(setId, changes));
      setOnlyLearned(true);
    },
    [setId],
  );

  const clearOnlyLearned = useCallback(() => {
    clearDrillPoolMode(setId);
    setOnlyLearned(false);
  }, [setId]);

  return { clearOnlyLearned, enableOnlyLearned, onlyLearned, pool, setEnabled, setManyEnabled };
}
