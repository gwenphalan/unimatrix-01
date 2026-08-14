import { deriveOllDiagram, derivePllDiagram } from "@unimatrix/cube";
import type { FaceletCube, LastLayerDiagram } from "@unimatrix/cube";

import type { AlgorithmSetId } from "./types";

/** Picks the OLL- or PLL-appropriate derivation for a given set, so callers don't hand-roll the ternary. */
export function deriveDiagramForSet(setId: AlgorithmSetId, cube: FaceletCube): LastLayerDiagram {
  return setId === "oll" ? deriveOllDiagram(cube) : derivePllDiagram(cube);
}
