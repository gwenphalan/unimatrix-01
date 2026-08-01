import { useCallback, useState } from "react";

import type { AlgorithmSetId } from "@/features/algorithms/types";
import { readAlgorithmSet, writeAlgorithmSet } from "@/lib/algorithm-set-storage";

export interface UseAlgorithmSetResult {
  setId: AlgorithmSetId;
  setSetId: (setId: AlgorithmSetId) => void;
}

export function useAlgorithmSet(): UseAlgorithmSetResult {
  const [setId, setStoredSetId] = useState<AlgorithmSetId>(() => readAlgorithmSet());

  const setSetId = useCallback((nextSetId: AlgorithmSetId) => {
    writeAlgorithmSet(nextSetId);
    setStoredSetId(nextSetId);
  }, []);

  return { setId, setSetId };
}
