import * as React from "react";

/** Fine lattice tile, in px. Matches `.grid-backdrop`'s 40px background tier. */
const GRID = 40;

/** Bold lattice tile, in px. Matches `.grid-backdrop`'s 240px background tier. */
const BOLD_GRID = GRID * 6;

/**
 * Offset that puts a line of a `tile`-sized lattice exactly on `extent`'s
 * midpoint: `background-position: P` on a tile of size T puts lines at
 * `P + n * T`, so a line hits `center` exactly when `P ≡ center (mod T)`.
 */
function latticePhase(extent: number, tile: number): number {
  return ((extent / 2) % tile) + (extent < 0 ? tile : 0);
}

/**
 * Phase for the bold 240px tier, offset half a tile from {@link latticePhase}
 * so the page's midpoint falls in the *middle of a bold cell* rather than on
 * the boundary between two of them. Centered content then sits inside one cell
 * instead of being split down the seam by a bold line.
 *
 * Half a bold tile is 120px — three fine cells — which is a whole multiple of
 * `GRID`, so the two tiers stay seam-locked and every bold line still lands on
 * a fine one.
 */
function boldLatticePhase(extent: number): number {
  return (latticePhase(extent, BOLD_GRID) + BOLD_GRID / 2) % BOLD_GRID;
}

/**
 * Centers the `.grid-backdrop` lattice on the page by writing the four phase
 * variables it reads. Renders nothing — the grid itself is painted by CSS on
 * `<body class="grid-backdrop">`; this component owns only the measurement
 * that keeps it aligned.
 *
 * Without it the lattice falls back to a plain `0 0` origin and sits visibly
 * off-center against centered content on any viewport whose half-extent is not
 * a whole number of cells: the content edges end up at different distances
 * from their nearest lines. Content is centered in the viewport — the `mx-auto
 * max-w-[92rem]` shell's rect center equals `clientWidth / 2` — so the viewport
 * centerline is the content centerline.
 *
 * Mount it once per app, inside the shell. It is safe at every width: the grid
 * paints on mobile too, so there is no viewport gate here.
 *
 * `ResizeObserver` on `documentElement`, not a `window.innerWidth/innerHeight`
 * dependency — this centers against `clientWidth/clientHeight`, which excludes
 * the scrollbar gutter, so a vertical scrollbar toggling on or off moves the
 * measurement with no matching `innerWidth/innerHeight` change to re-trigger a
 * size-keyed effect. `clientHeight` on `documentElement` is the *viewport*
 * height rather than the content height, so this fires on real viewport changes
 * only and never thrashes against page growth.
 *
 * Verified: the observer does deliver on a real viewport resize
 * (`apps/web/e2e/grid-phase.spec.ts`). The scrollbar-gutter case above is the
 * stated reason for preferring `clientWidth` over `innerWidth` but is *not*
 * itself verified — headless Chromium uses overlay scrollbars, so it does not
 * reproduce there. Treat it as the design rationale, not a tested guarantee.
 */
export function GraphBackground(): null {
  React.useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      root.style.setProperty("--grid-phase-x", `${latticePhase(root.clientWidth, GRID)}px`);
      root.style.setProperty("--grid-phase-y", `${latticePhase(root.clientHeight, GRID)}px`);
      root.style.setProperty("--grid-bold-phase-x", `${boldLatticePhase(root.clientWidth)}px`);
      root.style.setProperty("--grid-bold-phase-y", `${boldLatticePhase(root.clientHeight)}px`);
    };

    apply();
    const observer = new ResizeObserver(() => {
      apply();
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
