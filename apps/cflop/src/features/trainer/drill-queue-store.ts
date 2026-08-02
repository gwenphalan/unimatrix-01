import type { AlgorithmSetId } from "@/features/algorithms/types";
import type { DrillQueue } from "@/features/trainer/drill-queue";

/**
 * Where a drill's bag lives between mounts. `TrainerPanel` unmounts whenever Choose cases opens
 * and remounts under a fresh `key` when the set changes, so a queue held in the component would
 * reshuffle on both - and a bag that restarts every time the pool is inspected gives none of the
 * even coverage it exists for.
 *
 * Module scope rather than `localStorage`: the guarantee wanted is within a sitting, and a bag
 * surviving a reload would mean a drill resumed days later opening on the tail of a forgotten
 * one. Keyed by set so OLL and PLL keep their own place across a switch.
 */
const queues = new Map<AlgorithmSetId, DrillQueue>();

export function readDrillQueue(setId: AlgorithmSetId): DrillQueue | undefined {
  return queues.get(setId);
}

export function writeDrillQueue(setId: AlgorithmSetId, queue: DrillQueue): void {
  queues.set(setId, queue);
}
