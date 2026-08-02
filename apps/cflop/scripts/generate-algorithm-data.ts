/**
 * Regenerates `src/features/algorithms/{oll,pll}-algorithms.data.ts` from the MIT-licensed
 * sources vendored under `vendor/`. Run it with `pnpm --filter @unimatrix/cflop gen:algs`.
 *
 * Every check below exits non-zero before anything is written: both files are assembled in
 * memory, asserted, and only then written, so a bad run leaves the committed data untouched
 * rather than half-replaced.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

import { deriveDiagramForSet } from "@/features/algorithms/derive-diagram";
import type { AlgorithmSetId } from "@/features/algorithms/types";
import { applyMoves, netRotationFor } from "@/features/cube/engine";
import { createSolvedCube, isBottomTwoLayersSolved } from "@/features/cube/model";
import { invertMoves, parseAlgorithm } from "@/features/cube/notation";
import { rewriteAsOuterMoves, simplifyMoves } from "@/features/cube/outer-moves";

interface JoinRow {
  id: string;
  displayName: string;
  group: string;
  caseFrequency: number;
  /**
   * Prepended to the upstream primary so the case's diagram matches the orientation the
   * cubing community draws it at. A literal rather than something derived from the outgoing
   * data: derived, a second run would read its own output and compute no offset at all.
   */
  pinnedPrefix: string;
}

interface OllRow extends JoinRow {
  ollNumber: number;
}

interface PllRow extends JoinRow {
  pllLetter: string;
}

/**
 * Case identity, group membership, Learn's sort key and emission order, in one place.
 *
 * Order is load-bearing: `orderedLearnCases` sorts by `caseFrequency` descending and
 * `Array.prototype.sort` is stable, so within a group the file's order is the teaching order.
 *
 * `caseFrequency` is carried rather than computed. It is not derivable as an orbit size under
 * U turns - that reproduces OLL's 215 but gives 84 against PLL's 71.
 */
// prettier-ignore
const OLL_JOIN: OllRow[] = [
  { id: "oll-1", displayName: "OLL 1", group: "Dot", ollNumber: 1, caseFrequency: 2, pinnedPrefix: "" },
  { id: "oll-2", displayName: "OLL 2", group: "Dot", ollNumber: 2, caseFrequency: 4, pinnedPrefix: "U'" },
  { id: "oll-3", displayName: "OLL 3", group: "Dot", ollNumber: 3, caseFrequency: 4, pinnedPrefix: "U'" },
  { id: "oll-4", displayName: "OLL 4", group: "Dot", ollNumber: 4, caseFrequency: 4, pinnedPrefix: "U'" },
  { id: "oll-5", displayName: "OLL 5", group: "Square Shape", ollNumber: 5, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-6", displayName: "OLL 6", group: "Square Shape", ollNumber: 6, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-7", displayName: "OLL 7", group: "Small Lightning Bolt", ollNumber: 7, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-8", displayName: "OLL 8", group: "Small Lightning Bolt", ollNumber: 8, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-9", displayName: "OLL 9", group: "Fish Shape", ollNumber: 9, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-10", displayName: "OLL 10", group: "Fish Shape", ollNumber: 10, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-11", displayName: "OLL 11", group: "Small Lightning Bolt", ollNumber: 11, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-12", displayName: "OLL 12", group: "Small Lightning Bolt", ollNumber: 12, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-13", displayName: "OLL 13", group: "Knight Move Shape", ollNumber: 13, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-14", displayName: "OLL 14", group: "Knight Move Shape", ollNumber: 14, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-15", displayName: "OLL 15", group: "Knight Move Shape", ollNumber: 15, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-16", displayName: "OLL 16", group: "Knight Move Shape", ollNumber: 16, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-17", displayName: "OLL 17", group: "Dot", ollNumber: 17, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-18", displayName: "OLL 18", group: "Dot", ollNumber: 18, caseFrequency: 4, pinnedPrefix: "U" },
  { id: "oll-19", displayName: "OLL 19", group: "Dot", ollNumber: 19, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-20", displayName: "OLL 20", group: "Dot", ollNumber: 20, caseFrequency: 1, pinnedPrefix: "" },
  { id: "oll-21", displayName: "OLL 21", group: "Cross", ollNumber: 21, caseFrequency: 2, pinnedPrefix: "U" },
  { id: "oll-22", displayName: "OLL 22", group: "Cross", ollNumber: 22, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-23", displayName: "OLL 23", group: "Cross", ollNumber: 23, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-24", displayName: "OLL 24", group: "Cross", ollNumber: 24, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-25", displayName: "OLL 25", group: "Cross", ollNumber: 25, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-26", displayName: "OLL 26", group: "Cross", ollNumber: 26, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-27", displayName: "OLL 27", group: "Cross", ollNumber: 27, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-28", displayName: "OLL 28", group: "Corners Oriented", ollNumber: 28, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-29", displayName: "OLL 29", group: "Awkward Shape", ollNumber: 29, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-30", displayName: "OLL 30", group: "Awkward Shape", ollNumber: 30, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-31", displayName: "OLL 31", group: "P Shape", ollNumber: 31, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-32", displayName: "OLL 32", group: "P Shape", ollNumber: 32, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-33", displayName: "OLL 33", group: "T Shape", ollNumber: 33, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-34", displayName: "OLL 34", group: "C Shape", ollNumber: 34, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-35", displayName: "OLL 35", group: "Fish Shape", ollNumber: 35, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-36", displayName: "OLL 36", group: "W Shape", ollNumber: 36, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-37", displayName: "OLL 37", group: "Fish Shape", ollNumber: 37, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-38", displayName: "OLL 38", group: "W Shape", ollNumber: 38, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-39", displayName: "OLL 39", group: "Big Lightning Bolt", ollNumber: 39, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-40", displayName: "OLL 40", group: "Big Lightning Bolt", ollNumber: 40, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-41", displayName: "OLL 41", group: "Awkward Shape", ollNumber: 41, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-42", displayName: "OLL 42", group: "Awkward Shape", ollNumber: 42, caseFrequency: 4, pinnedPrefix: "U" },
  { id: "oll-43", displayName: "OLL 43", group: "P Shape", ollNumber: 43, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-44", displayName: "OLL 44", group: "P Shape", ollNumber: 44, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-45", displayName: "OLL 45", group: "T Shape", ollNumber: 45, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-46", displayName: "OLL 46", group: "C Shape", ollNumber: 46, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-47", displayName: "OLL 47", group: "Small L Shape", ollNumber: 47, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-48", displayName: "OLL 48", group: "Small L Shape", ollNumber: 48, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-49", displayName: "OLL 49", group: "Small L Shape", ollNumber: 49, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-50", displayName: "OLL 50", group: "Small L Shape", ollNumber: 50, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-51", displayName: "OLL 51", group: "I Shape", ollNumber: 51, caseFrequency: 4, pinnedPrefix: "" },
  { id: "oll-52", displayName: "OLL 52", group: "I Shape", ollNumber: 52, caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "oll-53", displayName: "OLL 53", group: "Small L Shape", ollNumber: 53, caseFrequency: 4, pinnedPrefix: "U" },
  { id: "oll-54", displayName: "OLL 54", group: "Small L Shape", ollNumber: 54, caseFrequency: 4, pinnedPrefix: "U" },
  { id: "oll-55", displayName: "OLL 55", group: "I Shape", ollNumber: 55, caseFrequency: 2, pinnedPrefix: "" },
  { id: "oll-56", displayName: "OLL 56", group: "I Shape", ollNumber: 56, caseFrequency: 2, pinnedPrefix: "" },
  { id: "oll-57", displayName: "OLL 57", group: "Corners Oriented", ollNumber: 57, caseFrequency: 2, pinnedPrefix: "" },
];

// prettier-ignore
const PLL_JOIN: PllRow[] = [
  { id: "pll-h", displayName: "PLL H", group: "Edges Only", pllLetter: "h", caseFrequency: 1, pinnedPrefix: "" },
  { id: "pll-z", displayName: "PLL Z", group: "Edges Only", pllLetter: "z", caseFrequency: 2, pinnedPrefix: "y U2" },
  { id: "pll-ua", displayName: "PLL Ua", group: "Edges Only", pllLetter: "ua", caseFrequency: 4, pinnedPrefix: "U2" },
  { id: "pll-ub", displayName: "PLL Ub", group: "Edges Only", pllLetter: "ub", caseFrequency: 4, pinnedPrefix: "y2" },
  { id: "pll-aa", displayName: "PLL Aa", group: "Adjacent Corner Swap", pllLetter: "aa", caseFrequency: 4, pinnedPrefix: "y" },
  { id: "pll-ab", displayName: "PLL Ab", group: "Adjacent Corner Swap", pllLetter: "ab", caseFrequency: 4, pinnedPrefix: "y2" },
  { id: "pll-e", displayName: "PLL E", group: "Diagonal Corner Swap", pllLetter: "e", caseFrequency: 2, pinnedPrefix: "" },
  { id: "pll-f", displayName: "PLL F", group: "Adjacent Corner Swap", pllLetter: "f", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-ja", displayName: "PLL Ja", group: "Adjacent Corner Swap", pllLetter: "ja", caseFrequency: 4, pinnedPrefix: "U'" },
  { id: "pll-jb", displayName: "PLL Jb", group: "Adjacent Corner Swap", pllLetter: "jb", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-ra", displayName: "PLL Ra", group: "Adjacent Corner Swap", pllLetter: "ra", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-rb", displayName: "PLL Rb", group: "Adjacent Corner Swap", pllLetter: "rb", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-t", displayName: "PLL T", group: "Adjacent Corner Swap", pllLetter: "t", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-y", displayName: "PLL Y", group: "Diagonal Corner Swap", pllLetter: "y", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-v", displayName: "PLL V", group: "Diagonal Corner Swap", pllLetter: "v", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-na", displayName: "PLL Na", group: "Diagonal Corner Swap", pllLetter: "na", caseFrequency: 1, pinnedPrefix: "" },
  { id: "pll-nb", displayName: "PLL Nb", group: "Diagonal Corner Swap", pllLetter: "nb", caseFrequency: 1, pinnedPrefix: "" },
  { id: "pll-ga", displayName: "PLL Ga", group: "Adjacent Corner Swap", pllLetter: "ga", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-gb", displayName: "PLL Gb", group: "Adjacent Corner Swap", pllLetter: "gb", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-gc", displayName: "PLL Gc", group: "Adjacent Corner Swap", pllLetter: "gc", caseFrequency: 4, pinnedPrefix: "" },
  { id: "pll-gd", displayName: "PLL Gd", group: "Adjacent Corner Swap", pllLetter: "gd", caseFrequency: 4, pinnedPrefix: "" },
];

/** Group names the emitted files may use, mirroring `algorithm-sets.ts`'s two `groupOrder` arrays. */
const OLL_GROUPS = new Set([
  "Dot",
  "Square Shape",
  "Small Lightning Bolt",
  "Fish Shape",
  "Knight Move Shape",
  "Cross",
  "Corners Oriented",
  "Awkward Shape",
  "P Shape",
  "T Shape",
  "C Shape",
  "W Shape",
  "Big Lightning Bolt",
  "Small L Shape",
  "I Shape",
]);

const PLL_GROUPS = new Set(["Edges Only", "Adjacent Corner Swap", "Diagonal Corner Swap"]);

/** Matches today's longest case. Past four the marginal entry is an AUF variant of one already listed. */
const ALGORITHMS_PER_CASE = 4;

/**
 * The prefixes an alternate may be turned by to reach the primary's state. A `y` alone would
 * be enough for a case whose primary carries one, but `pll-z`'s pinned prefix is `y U2`, so
 * both axes have to be searched together.
 */
const ALIGNMENT_PREFIXES = ["", "y", "y2", "y'"].flatMap((rotation) =>
  ["", "U", "U2", "U'"].map((auf) => [rotation, auf].filter(Boolean).join(" ")),
);

const OLL_FREQUENCY_SUM = 215;
const PLL_FREQUENCY_SUM = 71;

const here = new URL(".", import.meta.url);

function fail(message: string): never {
  console.error(`generate-algorithm-data: ${message}`);
  process.exit(1);
}

/**
 * The three rewrites the vendored notation needs before `parseAlgorithm` accepts it: cubedex
 * writes simultaneous turns as `D+U'` and half turns as both `U2'` and `U'2`. Grouping parens
 * are left alone - the parser strips them, and they are how a cuber reads a trigger.
 */
function normalizeNotation(algorithm: string): string {
  return algorithm
    .replaceAll("+", " ")
    .replaceAll("2'", "2")
    .replaceAll("'2", "2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ignores grouping and spacing, so `(R U R')` and `R U R'` are one algorithm rather than two. */
function dedupeKey(algorithm: string): string {
  return algorithm.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
}

const QUARTER_TURNS: Record<string, number> = { 1: 1, 2: 2, 3: 3, "'": 3 };
const TURN_SUFFIXES = ["", "", "2", "'"];

/** A leading `U`/`y` token and how far it turns, or undefined for anything else. */
function readLeadingTurn(token: string): { face: string; turns: number } | undefined {
  const match = /^([Uy])(2|')?$/.exec(token);
  if (!match) return undefined;
  return { face: String(match[1]), turns: match[2] ? (QUARTER_TURNS[match[2]] as number) : 1 };
}

/**
 * Prepends an alignment prefix, collapsing it into whatever `U`/`y` turns the algorithm already
 * opens with. Both act on the same axis and commute, so the merge is state-preserving - and a
 * candidate written from another recognition angle usually does open on one, which is how
 * `y2 y2 M2 U' M U2 M' U' M2` and `U' U R U R'` would otherwise reach the screen.
 */
function withPrefix(prefix: string, algorithm: string): string {
  const tokens = [...prefix.split(" "), ...algorithm.split(" ")].filter(
    (token) => token.length > 0,
  );

  let leading = 0;
  const total = { U: 0, y: 0 };
  while (leading < tokens.length) {
    const turn = readLeadingTurn(tokens[leading] as string);
    if (!turn) break;
    total[turn.face as "U" | "y"] += turn.turns;
    leading++;
  }

  const collapsed = (["y", "U"] as const)
    .filter((face) => total[face] % 4 !== 0)
    .map((face) => `${face}${TURN_SUFFIXES[total[face] % 4] as string}`);

  return [...collapsed, ...tokens.slice(leading)].join(" ");
}

interface Setup {
  cube: ReturnType<typeof createSolvedCube>;
  diagram: string;
}

/**
 * The drill scramble for one algorithm: its inverse as outer face turns, exactly as
 * `chooseSetupAlgorithm` builds it. Returns undefined for a string the engine refuses, which
 * is a rejection for an alternate and a failure for a primary.
 */
function buildSetup(setId: AlgorithmSetId, algorithm: string): Setup | undefined {
  try {
    const moves = parseAlgorithm(algorithm);
    const setupMoves = simplifyMoves(
      rewriteAsOuterMoves([...netRotationFor(moves), ...invertMoves(moves)]),
    );
    const cube = applyMoves(createSolvedCube(), setupMoves);
    return { cube, diagram: JSON.stringify(deriveDiagramForSet(setId, cube)) };
  } catch {
    return undefined;
  }
}

function readVendored(name: string): string {
  return readFileSync(new URL(`../vendor/${name}`, here), "utf8");
}

interface CubedexSubset {
  subset: string;
  algorithms: { name: string; algorithm: string }[];
}

/** cubedex ships exactly one curated algorithm per case, which is what makes it the primary. */
function readCubedex(): { oll: Map<number, string>; pll: Map<string, string> } {
  const file = JSON.parse(readVendored("cubedex-defaultAlgs.json")) as Record<
    string,
    CubedexSubset[]
  >;

  const oll = new Map<number, string>();
  for (const subset of file.OLL ?? []) {
    for (const entry of subset.algorithms) {
      const match = /^OLL-(\d+)\b/.exec(entry.name);
      if (!match) fail(`cubedex OLL entry has no case number: "${entry.name}"`);
      oll.set(Number(match[1]), normalizeNotation(entry.algorithm));
    }
  }

  const pll = new Map<string, string>();
  for (const subset of file.PLL ?? []) {
    for (const entry of subset.algorithms) {
      const match = /^([A-Za-z]+) Perm$/.exec(entry.name);
      if (!match) fail(`cubedex PLL entry has no perm letter: "${entry.name}"`);
      pll.set(String(match[1]).toLowerCase(), normalizeNotation(entry.algorithm));
    }
  }

  return { oll, pll };
}

/**
 * Alg-Trainer's `js/alg_list.js` is a script of `var` declarations that assigns `window.algs`,
 * so it needs a stub `window` to evaluate at all. Only `var OLL` and `var PLL` are read - the
 * file's `oll_cubeskills` block is CubeSkills' own set and is deliberately left behind.
 *
 * `OLL` is keyed `{ OLL: [...57] }` and joined positionally: entry *i* is OLL number *i + 1*.
 * `PLL` is keyed by perm letter. Both hold `/`-separated variants in one string.
 */
function readAlgTrainer(): { oll: Map<number, string[]>; pll: Map<string, string[]> } {
  const context: {
    window: Record<string, unknown>;
    OLL?: { OLL?: string[] };
    PLL?: Record<string, string[]>;
  } = { window: {} };
  createContext(context);
  runInContext(readVendored("algtrainer-alg_list.js"), context);

  const rawOll = context.OLL?.OLL;
  if (!rawOll || rawOll.length !== 57) {
    fail(`Alg-Trainer var OLL holds ${rawOll?.length ?? 0} entries, expected 57`);
  }

  const split = (entry: string): string[] =>
    entry
      .split("/")
      .map(normalizeNotation)
      .filter((algorithm) => algorithm.length > 0);

  const oll = new Map<number, string[]>();
  rawOll.forEach((entry, index) => oll.set(index + 1, split(entry)));

  const pll = new Map<string, string[]>();
  for (const [letter, entries] of Object.entries(context.PLL ?? {})) {
    pll.set(letter.toLowerCase(), entries.flatMap(split));
  }

  return { oll, pll };
}

/** algdb keys its cases `"OLL <n>"` and `"<X> perm"`. */
function readAlgdb(): { oll: Map<number, string[]>; pll: Map<string, string[]> } {
  const parse = (name: string) =>
    JSON.parse(readVendored(name)) as { cases: { name: string; algs: string[] }[] };

  const oll = new Map<number, string[]>();
  for (const entry of parse("algdb-OLL.json").cases) {
    const match = /^OLL (\d+)$/.exec(entry.name);
    if (match) oll.set(Number(match[1]), entry.algs.map(normalizeNotation));
  }

  const pll = new Map<string, string[]>();
  for (const entry of parse("algdb-PLL.json").cases) {
    const match = /^([A-Za-z]+) perm$/.exec(entry.name);
    if (match) pll.set(String(match[1]).toLowerCase(), entry.algs.map(normalizeNotation));
  }

  return { oll, pll };
}

/**
 * Alternates are aligned here rather than filtered at runtime. Written from a different
 * recognition angle, an alternate reaches a last layer turned relative to the primary's, and
 * `chooseSetupAlgorithm` drops it - which is exactly the alternate that would have kept a
 * drill scramble from being the displayed algorithm spelled backwards.
 *
 * The alignment condition is `chooseSetupAlgorithm`'s own filter: bottom two layers solved,
 * and the same derived diagram as the primary's setup.
 */
function alignAlternate(
  setId: AlgorithmSetId,
  candidate: string,
  primaryDiagram: string,
): string | undefined {
  for (const prefix of ALIGNMENT_PREFIXES) {
    const aligned = withPrefix(prefix, candidate);
    const setup = buildSetup(setId, aligned);
    if (!setup) continue;
    if (!isBottomTwoLayersSolved(setup.cube)) continue;
    if (setup.diagram !== primaryDiagram) continue;
    return aligned;
  }

  return undefined;
}

interface EmittedCase {
  id: string;
  displayName: string;
  group: string;
  algorithms: string[];
  caseFrequency: number;
}

function buildCases<Row extends JoinRow>(
  setId: AlgorithmSetId,
  rows: Row[],
  groups: Set<string>,
  frequencySum: number,
  primaryOf: (row: Row) => string | undefined,
  candidatesOf: (row: Row) => string[],
): EmittedCase[] {
  const diagramByCase = new Map<string, string>();

  const cases = rows.map((row) => {
    if (!groups.has(row.group))
      fail(`${row.id}: group "${row.group}" is not in the set's groupOrder`);

    const upstream = primaryOf(row);
    if (!upstream) fail(`${row.id}: no upstream primary for this join row`);

    const primary = withPrefix(row.pinnedPrefix, upstream);
    const primarySetup = buildSetup(setId, primary);
    if (!primarySetup) fail(`${row.id}: primary "${primary}" has no outer-turn setup`);
    if (!isBottomTwoLayersSolved(primarySetup.cube)) {
      fail(`${row.id}: primary "${primary}" leaves the bottom two layers unsolved`);
    }

    diagramByCase.set(row.id, primarySetup.diagram);

    const algorithms = [primary];
    const seen = new Set([dedupeKey(primary)]);

    for (const candidate of candidatesOf(row)) {
      if (algorithms.length >= ALGORITHMS_PER_CASE) break;
      const aligned = alignAlternate(setId, candidate, primarySetup.diagram);
      if (!aligned) continue;
      const key = dedupeKey(aligned);
      if (seen.has(key)) continue;
      seen.add(key);
      algorithms.push(aligned);
    }

    return {
      algorithms,
      caseFrequency: row.caseFrequency,
      displayName: row.displayName,
      group: row.group,
      id: row.id,
    };
  });

  const ids = new Set(cases.map((entry) => entry.id));
  if (ids.size !== cases.length) fail(`${setId}: duplicate case ids in the join table`);

  // Two rows resolving to one upstream case: the picker would show the same diagram twice and
  // nothing downstream would notice. It does not catch a row pinned to the wrong orientation.
  const diagrams = new Set(diagramByCase.values());
  if (diagrams.size !== cases.length) {
    fail(`${setId}: ${cases.length} cases derive only ${diagrams.size} distinct diagrams`);
  }

  const total = cases.reduce((sum, entry) => sum + entry.caseFrequency, 0);
  if (total !== frequencySum) {
    fail(`${setId}: caseFrequency sums to ${total}, expected ${frequencySum}`);
  }

  return cases;
}

function renderFile(exportName: string, cases: EmittedCase[]): string {
  const entries = cases
    .map((entry) =>
      [
        "  {",
        `    id: ${JSON.stringify(entry.id)},`,
        `    displayName: ${JSON.stringify(entry.displayName)},`,
        `    group: ${JSON.stringify(entry.group)},`,
        `    algorithms: [${entry.algorithms.map((algorithm) => JSON.stringify(algorithm)).join(", ")}],`,
        `    caseFrequency: ${entry.caseFrequency},`,
        "  },",
      ].join("\n"),
    )
    .join("\n");

  return [
    `import type { AlgorithmCase } from "./types";`,
    ``,
    `// Generated by scripts/generate-algorithm-data.ts from the sources vendored under`,
    `// apps/cflop/vendor. Regenerate with \`pnpm --filter @unimatrix/cflop gen:algs\` rather`,
    `// than editing entries here.`,
    `export const ${exportName}: AlgorithmCase[] = [`,
    entries,
    `];`,
    ``,
  ].join("\n");
}

const cubedex = readCubedex();
const algTrainer = readAlgTrainer();
const algdb = readAlgdb();

if (OLL_JOIN.length !== 57) fail(`OLL join table holds ${OLL_JOIN.length} rows, expected 57`);
if (PLL_JOIN.length !== 21) fail(`PLL join table holds ${PLL_JOIN.length} rows, expected 21`);

const claimedOllNumbers = new Set(OLL_JOIN.map((row) => row.ollNumber));
for (const number of cubedex.oll.keys()) {
  if (!claimedOllNumbers.has(number)) fail(`cubedex OLL ${number} is claimed by no join row`);
}
const claimedPllLetters = new Set(PLL_JOIN.map((row) => row.pllLetter));
for (const letter of cubedex.pll.keys()) {
  if (!claimedPllLetters.has(letter)) fail(`cubedex ${letter} perm is claimed by no join row`);
}

const ollCases = buildCases(
  "oll",
  OLL_JOIN,
  OLL_GROUPS,
  OLL_FREQUENCY_SUM,
  (row) => cubedex.oll.get(row.ollNumber),
  (row) => [...(algTrainer.oll.get(row.ollNumber) ?? []), ...(algdb.oll.get(row.ollNumber) ?? [])],
);

const pllCases = buildCases(
  "pll",
  PLL_JOIN,
  PLL_GROUPS,
  PLL_FREQUENCY_SUM,
  (row) => cubedex.pll.get(row.pllLetter),
  (row) => [...(algTrainer.pll.get(row.pllLetter) ?? []), ...(algdb.pll.get(row.pllLetter) ?? [])],
);

// `cube-engine.test.ts`'s alternate suites are built from the cases carrying more than one
// algorithm. An empty collection there produces no test cases and no failure, so the emptiness
// is caught here instead.
for (const [setId, cases] of [
  ["oll", ollCases],
  ["pll", pllCases],
] as const) {
  const withAlternates = cases.filter((entry) => entry.algorithms.length > 1).length;
  if (withAlternates === 0) fail(`${setId}: no case gained an alternate`);
  console.log(
    `${setId}: ${cases.length} cases, ${cases.reduce((sum, entry) => sum + entry.algorithms.length, 0)} algorithms, ${withAlternates} with alternates`,
  );
}

const outputs = [
  {
    path: new URL("../src/features/algorithms/oll-algorithms.data.ts", here),
    contents: renderFile("OLL_ALGORITHMS", ollCases),
  },
  {
    path: new URL("../src/features/algorithms/pll-algorithms.data.ts", here),
    contents: renderFile("PLL_ALGORITHMS", pllCases),
  },
];

for (const output of outputs) writeFileSync(output.path, output.contents);

// The emitted files sit inside `prettier --check .`'s scope, and a template emitter does not
// agree with prettier on wrapping. Formatting them here is what keeps `pnpm check` green.
const formatted = spawnSync(
  "pnpm",
  ["exec", "prettier", "--write", ...outputs.map((output) => fileURLToPath(output.path))],
  { stdio: "inherit" },
);
if (formatted.status !== 0) fail(`prettier exited with ${formatted.status}`);
