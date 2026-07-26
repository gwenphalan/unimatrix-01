import { describe, expect, it } from "vitest";

import { GRID, type RoutePoint } from "../src/components/grid-math.js";
import {
  IDLE_PACKET_POOL_SIZE,
  PACKET_MAX_HOPS,
  advancePacket,
  buildPacketGraph,
  cellPoint,
  chooseNextCell,
  packetPosition,
  type Packet,
} from "../src/components/idle-packets.js";
import { generateTraces } from "../src/components/trace-generation.js";
import { recomputeCorners, densify } from "../src/components/grid-math.js";

function rp(x: number, y: number): RoutePoint {
  return { x, y, corner: true };
}

describe("buildPacketGraph", () => {
  it("connects consecutive cells within a body and shares nodes across traces", () => {
    const bodies = new Map<string, RoutePoint[]>([
      ["t0", [rp(0, 0), rp(GRID, 0), rp(2 * GRID, 0)]],
      ["t1", [rp(GRID, GRID), rp(GRID, 0)]], // shares the "1,0" cell with t0
    ]);

    const graph = buildPacketGraph(bodies);

    expect(graph.neighbors.get("0,0")).toEqual(new Set(["1,0"]));
    expect(graph.neighbors.get("1,0")).toEqual(new Set(["0,0", "2,0", "1,1"]));
    expect(graph.leaves).toContain("0,0");
    expect(graph.leaves).toContain("2,0");
    expect(graph.leaves).toContain("1,1");
    expect(graph.junctions).toEqual(["1,0"]);
  });

  it("neighbor symmetry: every edge appears in both directions", () => {
    const bodies = new Map<string, RoutePoint[]>([["t0", [rp(0, 0), rp(GRID, 0), rp(GRID, GRID)]]]);
    const graph = buildPacketGraph(bodies);

    graph.neighbors.forEach((set, key) => {
      set.forEach((neighbor) => {
        expect(graph.neighbors.get(neighbor)?.has(key)).toBe(true);
      });
    });
  });

  it("stays a single connected component over real generateTraces output", () => {
    const { traces } = generateTraces(1200, 900, 42, [], 14);
    const bodies = new Map(traces.map((t) => [t.id, recomputeCorners(densify(t.points))]));
    const graph = buildPacketGraph(bodies);

    const allKeys = Array.from(graph.neighbors.keys());
    expect(allKeys.length).toBeGreaterThan(0);

    const visited = new Set<string>();
    const stack = [allKeys[0] as string];
    while (stack.length > 0) {
      const key = stack.pop() as string;
      if (visited.has(key)) continue;
      visited.add(key);
      graph.neighbors.get(key)?.forEach((n) => {
        if (!visited.has(n)) stack.push(n);
      });
    }

    expect(visited.size).toBe(allKeys.length);
  });
});

describe("cellPoint", () => {
  it("round-trips a cellKey back to lattice coordinates", () => {
    expect(cellPoint("3,-2")).toEqual({ x: 3 * GRID, y: -2 * GRID });
  });
});

describe("chooseNextCell", () => {
  it("never returns cameFrom", () => {
    const graph = buildPacketGraph(new Map([["t0", [rp(0, 0), rp(GRID, 0), rp(2 * GRID, 0)]]]));
    const rand = () => 0.9; // would pick the last candidate if cameFrom weren't filtered
    expect(chooseNextCell(graph, "1,0", "0,0", rand)).toBe("2,0");
  });

  it("returns null at a dead end (only neighbor is cameFrom)", () => {
    const graph = buildPacketGraph(new Map([["t0", [rp(0, 0), rp(GRID, 0)]]]));
    expect(chooseNextCell(graph, "1,0", "0,0")).toBeNull();
  });

  it("returns null for a cell absent from the graph", () => {
    const graph = buildPacketGraph(new Map([["t0", [rp(0, 0), rp(GRID, 0)]]]));
    expect(chooseNextCell(graph, "99,99", null)).toBeNull();
  });
});

describe("packetPosition", () => {
  it("stays axis-aligned between adjacent cell centers", () => {
    const mid = packetPosition("0,0", "1,0", 0.5);
    expect(mid).toEqual({ x: GRID / 2, y: 0 });
  });

  it("clamps t to [0, 1]", () => {
    expect(packetPosition("0,0", "1,0", -1)).toEqual({ x: 0, y: 0 });
    expect(packetPosition("0,0", "1,0", 2)).toEqual({ x: GRID, y: 0 });
  });
});

describe("advancePacket", () => {
  const graph = buildPacketGraph(new Map([["t0", [rp(0, 0), rp(GRID, 0), rp(2 * GRID, 0)]]]));

  it("advances toward the chosen next cell over successive frames", () => {
    const start: Packet = { slot: 0, at: "0,0", cameFrom: null, next: null, stepStart: 0, hops: 0 };
    const first = advancePacket(start, graph, 0, () => 0); // picks "1,0" (only non-cameFrom option)
    expect(first).not.toBeNull();
    expect(first?.packet.next).toBe("1,0");

    const midway = advancePacket(first?.packet as Packet, graph, (first?.packet.stepStart ?? 0) + 55, () => 0);
    expect(midway?.point.x).toBeGreaterThan(0);
    expect(midway?.point.x).toBeLessThan(GRID);
    expect(midway?.point.y).toBe(0); // axis-aligned
  });

  it("retires (returns null) at a dead end", () => {
    const atLeaf: Packet = { slot: 0, at: "2,0", cameFrom: "1,0", next: null, stepStart: 0, hops: 1 };
    expect(advancePacket(atLeaf, graph, 0)).toBeNull();
  });

  it("retires at PACKET_MAX_HOPS", () => {
    const maxedOut: Packet = { slot: 0, at: "1,0", cameFrom: "0,0", next: null, stepStart: 0, hops: PACKET_MAX_HOPS };
    expect(advancePacket(maxedOut, graph, 0)).toBeNull();
  });

  it("pool cap constant is a sane positive integer", () => {
    expect(IDLE_PACKET_POOL_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(IDLE_PACKET_POOL_SIZE)).toBe(true);
  });
});
