import { useEffect, useState, type ComponentType } from "react";
import { ToolTitleBar } from "@unimatrix/chrome/tool";

import { findPrototype, loadPrototype } from "@/lib/prototype-registry";

// Every variant carries the id it belongs to. Without that, changing
// `prototypeId` leaves the PREVIOUS component rendering under the new title
// until the new import resolves — a stale sketch shown as if it were the one
// asked for, which is worse than a blank frame.
type LoadState =
  | { status: "loading"; id: string }
  | { status: "ready"; id: string; Component: ComponentType }
  | { status: "error"; id: string; message: string };

/**
 * Renders one prototype below a title bar that gets back to the index.
 *
 * `useState` + `useEffect` rather than `React.lazy` + `Suspense`: a prototype
 * that fails to load is the normal case here — a half-written sketch, a missing
 * default export, a stale import after a shared component moved — and an error
 * boundary that renders a blank screen would make every one of those look the
 * same. The message names the file.
 */
export function PrototypeHostPage({ prototypeId }: { prototypeId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading", id: prototypeId });
  const entry = findPrototype(prototypeId);

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading", id: prototypeId });

    loadPrototype(prototypeId)
      .then((module) => {
        if (!cancelled) {
          setState({ status: "ready", id: prototypeId, Component: module.default });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            id: prototypeId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [prototypeId]);

  return (
    <div className="flex w-full flex-col gap-6">
      <ToolTitleBar
        back={{ label: "Back to prototypes", to: "/" }}
        title={entry?.title ?? prototypeId}
      />

      {state.id !== prototypeId || state.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading {prototypeId}…</p>
      ) : null}

      {state.status === "error" ? (
        <p className="border border-destructive/45 px-4 py-3 font-mono text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      {state.status === "ready" ? <state.Component /> : null}
    </div>
  );
}
