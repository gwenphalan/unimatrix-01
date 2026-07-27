import * as React from "react";
import { createPortal } from "react-dom";

import { getCircuitDebugState, subscribeCircuitDebug } from "./circuit-debug.js";
import { useCircuitOccluderDelta } from "./circuit-occluder.js";
import { GRID } from "./grid-math.js";
import { OCCLUDER_BUFFER_PX, type Occluder, buildBarrierField, inflateRect } from "./occlusion.js";

// Hardcoded, not theme tokens — this must stay legible on every app's
// palette regardless of light/dark mode or brand color.
const RAW_STROKE = "#ff00d0";
const BUFFERED_STROKE = "#ffb000";
const BUFFERED_FILL = "rgba(255, 176, 0, 0.15)";
const CELL_FILL = "rgba(255, 176, 0, 0.35)";

export type CircuitDebugOverlayProps = { occluders: readonly Occluder[] };

/**
 * Draws every registered occluder's raw measured rect (thin dashed magenta
 * stroke) and buffer-inflated barrier rect (solid amber stroke + fill) on
 * top of everything, so the hard-barrier geometry `generateTraces`/
 * `buildRoute`/`retargetTip` actually enforce can be visually inspected.
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
export function CircuitDebugOverlay({ occluders }: CircuitDebugOverlayProps): React.JSX.Element | null {
  const debugState = React.useSyncExternalStore(subscribeCircuitDebug, getCircuitDebugState, getCircuitDebugState);
  const [liveOccluders, setLiveOccluders] = React.useState<readonly Occluder[] | null>(null);

  useCircuitOccluderDelta(
    React.useCallback((_dirtyRects, live) => {
      setLiveOccluders(live);
    }, []),
  );

  if (!debugState.enabled) return null;
  if (typeof document === "undefined") return null;

  const active = liveOccluders ?? occluders;
  const buffered = active.map((rect) => inflateRect(rect, OCCLUDER_BUFFER_PX));
  const blockedCells = debugState.cells ? Array.from(buildBarrierField(active).cells) : [];

  return createPortal(
    <svg
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, height: "100vh", width: "100vw", pointerEvents: "none", zIndex: 2147483000 }}
    >
      {blockedCells.map((key) => {
        const [cx, cy] = key.split(",").map(Number) as [number, number];
        return (
          <rect
            fill={CELL_FILL}
            height={GRID}
            key={key}
            width={GRID}
            x={cx * GRID - GRID / 2}
            y={cy * GRID - GRID / 2}
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
