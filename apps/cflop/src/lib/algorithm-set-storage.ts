import { z } from "zod";

import { ALGORITHM_SET_IDS, type AlgorithmSetId } from "@/features/algorithms/types";

import { readStoredValue, writeStoredValue } from "./local-storage";

/**
 * One key, no scope segment: Learn and Drill share the choice, so picking PLL in one is picking it
 * in the other.
 */
const STORAGE_KEY = "algorithm-set";

const DEFAULT_ALGORITHM_SET: AlgorithmSetId = "oll";

const algorithmSetSchema = z.enum(ALGORITHM_SET_IDS);

export function readAlgorithmSet(): AlgorithmSetId {
  const parsed = algorithmSetSchema.safeParse(readStoredValue(STORAGE_KEY));

  return parsed.success ? parsed.data : DEFAULT_ALGORITHM_SET;
}

export function writeAlgorithmSet(setId: AlgorithmSetId): void {
  writeStoredValue(STORAGE_KEY, setId);
}
