import { GRID, type Point, type RoutePoint, cellKey } from "./grid-math.js";

// Built from live `liveBodyRef` bodies at settle, not `CircuitTree.adjacency`
// — live geometry includes scroll retargets and idle shifts, generation-time
// adjacency goes stale the first time a tip moves. `CircuitTree.adjacency`
// therefore stays unconsumed in production, exercised only by
// `trace-generation.test.ts`.
export type PacketGraph = {
  neighbors: ReadonlyMap<string, ReadonlySet<string>>;
  leaves: readonly string[];
  junctions: readonly string[];
};

/**
 * Undirected adjacency over every live body's dense cells — consecutive
 * points within a body connect, and two different traces sharing a cell (a
 * real T-junction/crossing, routine since Session C's spanning-tree
 * generator) naturally merge into one connected graph at that cell, exactly
 * matching what a packet visually walking the rendered lines should see.
 */
export function buildPacketGraph(bodies: ReadonlyMap<string, readonly RoutePoint[]>): PacketGraph {
  const neighbors = new Map<string, Set<string>>();

  const connect = (a: string, b: string) => {
    if (a === b) return;
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    (neighbors.get(a) as Set<string>).add(b);
    (neighbors.get(b) as Set<string>).add(a);
  };

  bodies.forEach((body) => {
    for (let i = 0; i < body.length - 1; i += 1) {
      connect(cellKey(body[i] as RoutePoint), cellKey(body[i + 1] as RoutePoint));
    }
  });

  const leaves: string[] = [];
  const junctions: string[] = [];
  neighbors.forEach((set, key) => {
    if (set.size === 1) leaves.push(key);
    else if (set.size >= 3) junctions.push(key);
  });

  return { neighbors, leaves, junctions };
}

export function cellPoint(key: string): Point {
  const parts = key.split(",");
  const cx = Number(parts[0]);
  const cy = Number(parts[1]);
  return { x: cx * GRID, y: cy * GRID };
}

/** Never returns `cameFrom` — a packet never immediately backtracks. Returns
 * `null` at a dead end (only neighbor was where it came from, or an
 * unconnected/missing cell). */
export function chooseNextCell(
  graph: PacketGraph,
  at: string,
  cameFrom: string | null,
  rand: () => number = Math.random,
): string | null {
  const neighborSet = graph.neighbors.get(at);
  if (!neighborSet || neighborSet.size === 0) return null;

  const candidates = Array.from(neighborSet).filter((n) => n !== cameFrom);
  if (candidates.length === 0) return null;

  const index = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length));
  return candidates[index] ?? null;
}

/** Linear (not eased) interpolation between two adjacent cells' centers. */
export function packetPosition(fromCell: string, toCell: string, t: number): Point {
  const from = cellPoint(fromCell);
  const to = cellPoint(toCell);
  const clamped = Math.max(0, Math.min(1, t));
  return { x: from.x + (to.x - from.x) * clamped, y: from.y + (to.y - from.y) * clamped };
}

export const PACKET_STEP_MS = 110;
export const IDLE_PACKET_POOL_SIZE = 12;
export const IDLE_PACKET_MAX_CONCURRENT = 8;
export const PACKET_SPAWN_INTERVAL_MS = 900;
// Deliberately *not* the normal retirement path — a packet must only ever
// vanish at a line's end, never mid-run, so the only routine way out of
// `advancePacket` is a dead end (`chooseNextCell` → `null`), which by
// definition is a degree-1 leaf cell. That terminates on its own: the walk
// never immediately backtracks, so on the tree the generator produces it is a
// simple path and always reaches a leaf. Cross-trace crossings can make the
// live graph slightly non-tree, so this stays as a cycle escape hatch only,
// set far above any plausible real traversal length.
export const PACKET_MAX_HOPS = 400;

export type Packet = {
  slot: number;
  at: string;
  cameFrom: string | null;
  next: string | null;
  stepStart: number;
  hops: number;
};

/**
 * Slots to retire because the cell a packet is walking toward (or, absent a
 * `next`, standing on) no longer exists on screen — the cull that lets a
 * packet keep running through a page transition instead of being retired
 * wholesale the instant a crawl starts: it disappears exactly when the
 * trace it's on is crawled past, not on the transition event itself.
 * Checks `next` before `at` deliberately — a packet mid-hop toward a cell
 * that's about to vanish should retire at that vanishing edge rather than
 * visibly interpolating one more hop toward cells that no longer render.
 */
export function packetsOffLiveGeometry(
  packets: ReadonlyMap<number, Packet>,
  isCellLive: (cell: string) => boolean,
): number[] {
  const stale: number[] = [];

  packets.forEach((packet, slot) => {
    const cell = packet.next ?? packet.at;
    if (!isCellLive(cell)) stale.push(slot);
  });

  return stale;
}

/**
 * One frame's worth of packet advancement. Returns the packet's current
 * render position, or `null` if it just retired — the caller is responsible
 * for freeing the slot back to its pool. Retirement happens at a dead end
 * (i.e. at a leaf cell, the visible end of a line) and, as a cycle escape
 * hatch only, at `PACKET_MAX_HOPS`. Mutates nothing; callers own the `Packet`
 * objects and replace them with the returned next state.
 */
export function advancePacket(
  packet: Packet,
  graph: PacketGraph,
  now: number,
  rand: () => number = Math.random,
): { packet: Packet; point: Point } | null {
  if (packet.next === null) {
    if (packet.hops >= PACKET_MAX_HOPS) return null;
    const next = chooseNextCell(graph, packet.at, packet.cameFrom, rand);
    if (next === null) return null;
    return advancePacket({ ...packet, next, stepStart: now }, graph, now, rand);
  }

  const elapsed = now - packet.stepStart;
  const t = elapsed / PACKET_STEP_MS;

  if (t >= 1) {
    const arrived: Packet = { slot: packet.slot, at: packet.next, cameFrom: packet.at, next: null, stepStart: now, hops: packet.hops + 1 };
    return advancePacket(arrived, graph, now, rand);
  }

  return { packet, point: packetPosition(packet.at, packet.next, t) };
}
