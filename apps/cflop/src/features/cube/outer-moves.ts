import type { Move } from "./notation";

const OUTER_FACES = ["U", "D", "L", "R", "F", "B"] as const;

export type OuterFace = (typeof OUTER_FACES)[number];

type RotationFace = "x" | "y" | "z";

/**
 * A real type predicate rather than a cast: `Move.face` is a plain `string` and
 * `noUncheckedIndexedAccess` is on, so the face tables below can only be indexed after the
 * compiler has narrowed the face.
 */
export function isOuterFace(face: string): face is OuterFace {
  return (OUTER_FACES as readonly string[]).includes(face);
}

/** Which whole-cube rotation axis each outer face turns about. */
const AXIS: Record<OuterFace, RotationFace> = {
  B: "z",
  D: "y",
  F: "z",
  L: "x",
  R: "x",
  U: "y",
};

/**
 * `ROTATION_FACE_MAP[rot][f]` is the face `g` whose single turn equals the sequence
 * `rot f rot'`. The opposite conjugation (`rot' f rot`) is a genuinely different table, so
 * this one reads backwards if you expect it to name where `rot` sends `f`. Every entry is
 * asserted against the engine in `test/outer-moves.test.ts` - check there rather than
 * rewriting it from intuition.
 */
const ROTATION_FACE_MAP: Record<RotationFace, Record<OuterFace, OuterFace>> = {
  x: { B: "U", D: "B", F: "D", L: "L", R: "R", U: "F" },
  y: { B: "L", D: "D", F: "R", L: "F", R: "B", U: "U" },
  z: { B: "B", D: "R", F: "F", L: "D", R: "U", U: "L" },
};

/**
 * Every quarter turn the parser accepts that is not an outer face turn, written as outer
 * turns plus whole-cube rotations. The outer turns and the rotations in each entry all lie on
 * one axis and therefore commute, so their order within an entry does not matter.
 */
const NON_OUTER_DECOMPOSITIONS: Record<string, { outer: OuterFace[]; rotations: RotationFace[] }> =
  {
    E: { outer: ["U", "D", "D", "D"], rotations: ["y", "y", "y"] },
    M: { outer: ["R", "L", "L", "L"], rotations: ["x", "x", "x"] },
    S: { outer: ["F", "F", "F", "B"], rotations: ["z"] },
    b: { outer: ["F"], rotations: ["z", "z", "z"] },
    d: { outer: ["U"], rotations: ["y", "y", "y"] },
    f: { outer: ["B"], rotations: ["z"] },
    l: { outer: ["R"], rotations: ["x", "x", "x"] },
    r: { outer: ["L"], rotations: ["x"] },
    u: { outer: ["D"], rotations: ["y"] },
    x: { outer: [], rotations: ["x"] },
    y: { outer: [], rotations: ["y"] },
    z: { outer: [], rotations: ["z"] },
  };

function identityOrientation(): Record<OuterFace, OuterFace> {
  return { B: "B", D: "D", F: "F", L: "L", R: "R", U: "U" };
}

/**
 * Rewrites any legal move sequence into outer face turns alone - no rotations, no wide turns,
 * no `M`/`S`/`E`.
 *
 * **Emits quarter turns only**: `R'` comes back as `R R R`. The raw result must never reach
 * `movesToString`; pair it with `simplifyMoves`, which restores `2`/`'` notation.
 *
 * A sequence whose net whole-cube rotation is not the identity has no outer-turn-only form at
 * all (outer turns leave the centres where they are), so it throws rather than silently
 * dropping the rotation.
 */
export function rewriteAsOuterMoves(moves: readonly Move[]): Move[] {
  // Maps each face to where a turn of it lands once the rotations seen so far are folded in,
  // so an outer turn is emitted as `orientation[face]` and every rotation only spins this map.
  let orientation = identityOrientation();
  const rewritten: Move[] = [];

  const emit = (face: OuterFace) => {
    rewritten.push({ face: orientation[face], turns: 1 });
  };

  const spin = (rotation: RotationFace) => {
    const conjugated = ROTATION_FACE_MAP[rotation];
    const next = identityOrientation();
    for (const face of OUTER_FACES) {
      next[face] = orientation[conjugated[face]];
    }
    orientation = next;
  };

  for (const move of moves) {
    const decomposition = isOuterFace(move.face) ? undefined : NON_OUTER_DECOMPOSITIONS[move.face];

    if (!isOuterFace(move.face) && !decomposition) {
      throw new Error(`Cannot rewrite move face as outer turns: ${move.face}`);
    }

    for (let turn = 0; turn < move.turns; turn += 1) {
      if (decomposition) {
        for (const face of decomposition.outer) emit(face);
        for (const rotation of decomposition.rotations) spin(rotation);
      } else if (isOuterFace(move.face)) {
        emit(move.face);
      }
    }
  }

  if (OUTER_FACES.some((face) => orientation[face] !== face)) {
    throw new Error(
      "Move sequence carries a net whole-cube rotation, so it has no outer-turn-only form",
    );
  }

  return rewritten;
}

/**
 * Collapses a run of outer quarter turns back into `2`/`'` notation, merging each move into
 * the nearest earlier move on the same face and cascading past the moves in between when they
 * share its axis (`U`/`D`, `L`/`R` and `F`/`B` commute).
 *
 * A merged turn count of 0 drops the move entirely: `movesToString` renders `turns === 0` as a
 * bare face letter, which reads back as a real quarter turn.
 *
 * Rejects any face without an `AXIS` entry, because the cascade is only valid between moves
 * that commute - `simplifyMoves(parseAlgorithm("x y x"))` would otherwise return `"x2 y"`,
 * which is not equivalent to its input.
 */
export function simplifyMoves(moves: readonly Move[]): Move[] {
  const simplified: Move[] = [];

  for (const move of moves) {
    if (!isOuterFace(move.face)) {
      throw new Error(`Cannot simplify a non-outer move face: ${move.face}`);
    }

    const face = move.face;
    const axis = AXIS[face];
    let mergeIndex = -1;

    for (let i = simplified.length - 1; i >= 0; i -= 1) {
      const candidate = simplified[i];
      if (!candidate || !isOuterFace(candidate.face) || AXIS[candidate.face] !== axis) break;
      if (candidate.face === face) {
        mergeIndex = i;
        break;
      }
    }

    if (mergeIndex === -1) {
      const turns = move.turns % 4;
      if (turns !== 0) simplified.push({ face, turns });
      continue;
    }

    const merged = simplified[mergeIndex];
    if (!merged) continue;

    const turns = (merged.turns + move.turns) % 4;
    if (turns === 0) simplified.splice(mergeIndex, 1);
    else merged.turns = turns;
  }

  return simplified;
}
