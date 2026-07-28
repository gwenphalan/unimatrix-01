import * as React from "react";
import { createPortal } from "react-dom";

import { getCircuitDebugState, subscribeCircuitDebug } from "./circuit-debug.js";
import { useCircuitOccluderDelta } from "./circuit-occluder.js";
import { GRID, type Point } from "./grid-math.js";
import {
  OCCLUDER_BUFFER_PX,
  type Occluder,
  SOFT_OCCLUDER_BUFFER_PX,
  buildBarrierField,
  inflateRect,
  translateRect,
} from "./occlusion.js";

// Hardcoded, not theme tokens — this must stay legible on every app's
// palette regardless of light/dark mode or brand color.
const RAW_STROKE = "#ff00d0";
const BUFFERED_STROKE = "#ffb000";
const BUFFERED_FILL = "rgba(255, 176, 0, 0.15)";
const CELL_FILL = "rgba(255, 176, 0, 0.35)";
// The third colour the ink channel gets. Distinct hue rather than a lighter
// amber, because the whole point of looking at the overlay is telling apart a
// rect that blocks lattice cells from one that only blocks exact segments.
const SOFT_STROKE = "#00e5ff";
const SOFT_FILL = "rgba(0, 229, 255, 0.12)";

export type CircuitDebugOverlayProps = {
  occluders: readonly Occluder[];
  /**
   * The same `gridPhase` `CircuitField` renders its content `<g>` translated
   * by. Barriers are built against `-gridPhase`-shifted rects, so drawing the
   * blocked cells at their raw lattice coordinates would put them a phase
   * offset away from the lattice actually on screen.
   */
  gridPhase: Point;
};

/**
 * Draws every occluder's raw measured rect (thin dashed magenta stroke), each
 * hard rect's buffer-inflated barrier (solid amber stroke + fill), and each
 * ink rect's barrier (cyan stroke + fill) on top of everything, so the
 * geometry `generateTraces`/`buildRoute`/`retargetTip` actually enforce can be
 * visually inspected. Amber means "blocks lattice cells too"; cyan means
 * "exact-segment rejection only, cells stay passable".
 *
 * The overlay is a visual aid, not a measurement: for the precise sets, read
 * `window.__circuitField.occluders()`, which returns the committed `{hard,
 * soft}` rects the field was generated from.
 * Never rendered unless toggled on via `window.__circuitField.debug(true)`
 * in a browser console — see `circuit-debug.ts`. Renders through a portal
 * to `document.body` to escape any transformed/stacked ancestor.
 *
 * Uses `inflateRect` directly (the same primitive `buildBarrierField`
 * builds on) rather than a precomputed `BarrierField`, so the drawn
 * geometry can never drift from whatever `occluders` set is passed in —
 * including the scroll-fresh live set this component tracks itself via
 * `useCircuitOccluderDelta`, independent of the structural
 * `useCircuitOccluderRects()` commit `CircuitField` renders from.
 */
export function CircuitDebugOverlay({
  gridPhase,
  occluders,
}: CircuitDebugOverlayProps): React.JSX.Element | null {
  const debugState = React.useSyncExternalStore(
    subscribeCircuitDebug,
    getCircuitDebugState,
    getCircuitDebugState,
  );
  const [liveOccluders, setLiveOccluders] = React.useState<readonly Occluder[] | null>(null);

  useCircuitOccluderDelta(
    React.useCallback((_dirtyRects, live) => {
      setLiveOccluders(live);
    }, []),
  );

  // A structural commit is the authoritative fresh measurement, so drop the
  // scroll-time snapshot whenever one lands. Without this, the first scroll
  // pins `liveOccluders` forever and every later layout change (resize, route
  // change, a panel appearing) draws the overlay at geometry that no longer
  // exists — which reads as the barrier field being detached from the surface
  // it belongs to.
  React.useEffect(() => {
    setLiveOccluders(null);
  }, [occluders]);

  if (!debugState.enabled) return null;
  if (typeof document === "undefined") return null;

  const active = liveOccluders ?? occluders;
  // Split by kind before inflating. Drawing every rect with the hard buffer
  // was wrong in both directions: it overstated an ink rect's clearance by
  // 8px against 10px, and it drew ink as though it blocked lattice cells,
  // which it deliberately does not.
  const hard = active.filter((rect) => rect.kind !== "soft");
  const soft = active.filter((rect) => rect.kind === "soft");
  const buffered = hard.map((rect) => inflateRect(rect, OCCLUDER_BUFFER_PX));
  const bufferedSoft = soft.map((rect) => inflateRect(rect, SOFT_OCCLUDER_BUFFER_PX));
  // Built from `-gridPhase`-shifted rects and drawn back at `+gridPhase`,
  // the exact round trip `CircuitField` does — the raw and buffered rect
  // outlines below stay in plain viewport coordinates (they *are* element
  // rects), but a blocked cell is a lattice coordinate, and the lattice on
  // screen is phase-shifted.
  const blockedCells = debugState.cells
    ? Array.from(
        buildBarrierField(hard.map((rect) => translateRect(rect, -gridPhase.x, -gridPhase.y)))
          .cells,
      )
    : [];

  return createPortal(
    <svg
      aria-hidden="true"
      // Excluded from discovery and from mutation-triggered rescans — a debug
      // overlay that occluded against itself would change the very geometry it
      // exists to visualise.
      data-circuit-overlay=""
      style={{
        position: "fixed",
        inset: 0,
        height: "100vh",
        width: "100vw",
        pointerEvents: "none",
        zIndex: 2147483000,
      }}
    >
      {blockedCells.map((key) => {
        const [cx, cy] = key.split(",").map(Number) as [number, number];
        return (
          <rect
            fill={CELL_FILL}
            height={GRID}
            key={key}
            width={GRID}
            x={cx * GRID - GRID / 2 + gridPhase.x}
            y={cy * GRID - GRID / 2 + gridPhase.y}
          />
        );
      })}
      {buffered.map((rect, i) => (
        <rect
          fill={BUFFERED_FILL}
          height={Math.max(0, rect.y1 - rect.y0)}
          key={`buffered-${i}`}
          stroke={BUFFERED_STROKE}
          strokeWidth={1.5}
          width={Math.max(0, rect.x1 - rect.x0)}
          x={rect.x0}
          y={rect.y0}
        />
      ))}
      {bufferedSoft.map((rect, i) => (
        <rect
          fill={SOFT_FILL}
          height={Math.max(0, rect.y1 - rect.y0)}
          key={`soft-${i}`}
          stroke={SOFT_STROKE}
          strokeWidth={1}
          width={Math.max(0, rect.x1 - rect.x0)}
          x={rect.x0}
          y={rect.y0}
        />
      ))}
      {active.map((rect, i) => (
        <rect
          fill="none"
          height={Math.max(0, rect.y1 - rect.y0)}
          key={`raw-${i}`}
          stroke={RAW_STROKE}
          strokeDasharray="4 4"
          strokeWidth={1}
          width={Math.max(0, rect.x1 - rect.x0)}
          x={rect.x0}
          y={rect.y0}
        />
      ))}
    </svg>,
    document.body,
  );
}
