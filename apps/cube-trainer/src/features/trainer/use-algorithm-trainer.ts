import { useCallback, useMemo, useState } from "react";

import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import { useCasePool } from "@/features/algorithms/use-case-pool";
import type { FaceletCube } from "@/features/cube/model";
import { getCaseSetup } from "@/features/trainer/case-setup";
import { pickNextCase } from "@/features/trainer/pick-next-case";

export interface AlgorithmTrainerState {
  currentCase: AlgorithmCase | undefined;
  /** The case's cube state; the view derives whichever diagram the active preview mode needs. */
  cube: FaceletCube | undefined;
  setupMoves: string | undefined;
  next: () => void;
}

export function useAlgorithmTrainer(
  setId: AlgorithmSetId,
  cases: AlgorithmCase[],
): AlgorithmTrainerState {
  const { pool } = useCasePool(setId);
  const [currentCase, setCurrentCase] = useState<AlgorithmCase | undefined>(() =>
    pickNextCase(cases, pool, undefined),
  );

  const setup = useMemo(() => (currentCase ? getCaseSetup(currentCase) : undefined), [currentCase]);

  const next = useCallback(() => {
    setCurrentCase((previous) => pickNextCase(cases, pool, previous?.id));
  }, [cases, pool]);

  return useMemo(
    () => ({
      cube: setup?.cube,
      currentCase,
      next,
      setupMoves: setup?.setupMoves,
    }),
    [currentCase, next, setup],
  );
}
