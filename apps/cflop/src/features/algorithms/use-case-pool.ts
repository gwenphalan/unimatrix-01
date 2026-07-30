import { useCallback, useState } from "react";

import type { AlgorithmSetId } from "@/features/algorithms/types";
import { type CasePool, readCasePool, setCaseEnabled, setCasesEnabled } from "@/lib/pool-storage";

export interface UseCasePoolResult {
  pool: CasePool;
  setEnabled: (caseId: string, enabled: boolean) => void;
  /** Applies a whole id -> enabled record at once; see `setCasesEnabled`. */
  setManyEnabled: (changes: Readonly<Record<string, boolean>>) => void;
}

export function useCasePool(setId: AlgorithmSetId): UseCasePoolResult {
  const [pool, setPool] = useState<CasePool>(() => readCasePool(setId));

  const setEnabled = useCallback(
    (caseId: string, enabled: boolean) => {
      setPool(setCaseEnabled(setId, caseId, enabled));
    },
    [setId],
  );

  const setManyEnabled = useCallback(
    (changes: Readonly<Record<string, boolean>>) => {
      setPool(setCasesEnabled(setId, changes));
    },
    [setId],
  );

  return { pool, setEnabled, setManyEnabled };
}
