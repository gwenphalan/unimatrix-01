import type { AlgorithmCase } from "@/features/algorithms/types";
import type { CasePool } from "@/lib/pool-storage";
import { isCaseEnabled } from "@/lib/pool-storage";

/**
 * How many cases at the end of one bag are barred from the start of the next. Without it the
 * bags are each internally fair but the seam is not: the case dealt last is free to be dealt
 * first, which is the one repeat a drill notices.
 */
const SEAM_GUARD = 3;

/**
 * A shuffled bag of case ids and how far through it the drill has got. Every enabled case
 * appears exactly once in `order`, so a full pass deals each case exactly once; the bag is
 * rebuilt when it runs out.
 */
export interface DrillQueue {
  order: string[];
  /** Count of `order` already dealt, so `order[cursor]` is the next case out. */
  cursor: number;
}

export interface DrillQueueStep {
  queue: DrillQueue;
  caseId: string;
}

export type Random = () => number;

/**
 * The seam guard can only bar as many cases as the bag can seat after them, so it is capped at
 * half the pool: a pool of 6 or more gets the full 3, a pool of 2 alternates, and a pool of 1
 * gets no guard at all because there is no other case to deal.
 */
function seamGuardFor(poolSize: number): number {
  return Math.min(SEAM_GUARD, Math.floor(poolSize / 2));
}

function shuffle(ids: readonly string[], random: Random): string[] {
  const shuffled = [...ids];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as string, shuffled[i] as string];
  }

  return shuffled;
}

/**
 * Shuffles `ids` into a bag whose first `seamGuardFor(ids.length)` slots hold none of `barred`.
 *
 * Partitioning rather than reshuffling until the head is clean: a rejection loop's runtime is
 * unbounded, and on a small pool the acceptable orders are rare enough for it to hang the tab.
 * One pass over the shuffled ids fills the head from the first non-barred ones and everything
 * else keeps its shuffled order behind them, which puts every barred id at or past the guard
 * index by construction. The head is short enough (3) that the resulting bias - non-barred
 * cases are slightly likelier to come early - is exactly the constraint being asked for.
 */
function buildBag(ids: readonly string[], barred: ReadonlySet<string>, random: Random): string[] {
  const shuffled = shuffle(ids, random);
  const guard = seamGuardFor(ids.length);

  if (guard === 0 || barred.size === 0) {
    return shuffled;
  }

  const head: string[] = [];
  const rest: string[] = [];

  for (const id of shuffled) {
    if (head.length < guard && !barred.has(id)) {
      head.push(id);
    } else {
      rest.push(id);
    }
  }

  return [...head, ...rest];
}

/** The cases dealt most recently, newest last, capped at what the next bag's guard can bar. */
function recentlyDealt(queue: DrillQueue, nextPoolSize: number): Set<string> {
  const guard = seamGuardFor(nextPoolSize);

  return new Set(queue.order.slice(Math.max(0, queue.cursor - guard), queue.cursor));
}

/**
 * True when `queue` was built for exactly `enabledIds`. A bag is only fair over the pool it was
 * shuffled from, so any enable or disable retires it - continuing would either deal a case the
 * user just turned off or leave one they just turned on out until the bag ran dry.
 */
function matchesPool(queue: DrillQueue, enabledIds: readonly string[]): boolean {
  if (queue.order.length !== enabledIds.length) {
    return false;
  }

  const inQueue = new Set(queue.order);

  return enabledIds.every((id) => inQueue.has(id));
}

export function enabledCaseIds(cases: readonly AlgorithmCase[], pool: CasePool): string[] {
  return cases.filter((c) => isCaseEnabled(pool, c.id)).map((c) => c.id);
}

/**
 * Deals the next case, rebuilding the bag when it is spent or when the pool has changed under
 * it. Pure and total: the same `queue` and `enabledIds` with the same `random` always give the
 * same step, which is what lets the caller drive it from a React state updater that dev-mode
 * double invocation runs twice.
 *
 * Returns `undefined` only when nothing is enabled.
 */
export function advanceDrillQueue(
  queue: DrillQueue | undefined,
  enabledIds: readonly string[],
  random: Random = Math.random,
): DrillQueueStep | undefined {
  if (enabledIds.length === 0) {
    return undefined;
  }

  const spent = !queue || queue.cursor >= queue.order.length || !matchesPool(queue, enabledIds);

  const order = spent
    ? buildBag(
        enabledIds,
        // A retired bag's recent cases still count against the new one: the user saw them, and
        // whether the bag ended because it ran out or because the pool changed makes no
        // difference to that. Ids no longer enabled fall out of the guard on their own, since
        // the new bag cannot contain them anyway.
        queue ? recentlyDealt(queue, enabledIds.length) : new Set<string>(),
        random,
      )
    : queue.order;
  const cursor = spent ? 0 : queue.cursor;

  return { caseId: order[cursor] as string, queue: { cursor: cursor + 1, order } };
}
