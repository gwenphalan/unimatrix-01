import { useCallback, useEffect, useMemo, useState } from "react";

import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import { useCasePool } from "@/features/algorithms/use-case-pool";
import type { FaceletCube } from "@/features/cube/model";
import { getCaseSetup } from "@/features/trainer/case-setup";
import type { DrillQueueStep } from "@/features/trainer/drill-queue";
import { advanceDrillQueue, enabledCaseIds } from "@/features/trainer/drill-queue";
import { readDrillQueue, writeDrillQueue } from "@/features/trainer/drill-queue-store";

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
  const enabledIds = useMemo(() => enabledCaseIds(cases, pool), [cases, pool]);

  // Seeded from the store, then advanced only through the updater below. The initializer must
  // not read the store a second time: StrictMode invokes it twice, and the second read would
  // see the first invocation's write and burn two cases on one mount.
  const [step, setStep] = useState<DrillQueueStep | undefined>(() =>
    advanceDrillQueue(readDrillQueue(setId), enabledIds),
  );

  useEffect(() => {
    if (step) {
      writeDrillQueue(setId, step.queue);
    }
  }, [setId, step]);

  const currentCase = useMemo(
    () => (step ? cases.find((c) => c.id === step.caseId) : undefined),
    [cases, step],
  );

  const setup = useMemo(
    () => (currentCase ? getCaseSetup(currentCase, setId) : undefined),
    [currentCase, setId],
  );

  const next = useCallback(() => {
    setStep((previous) => advanceDrillQueue(previous?.queue, enabledIds));
  }, [enabledIds]);

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
