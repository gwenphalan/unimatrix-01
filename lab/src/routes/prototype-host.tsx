import { useEffect, useState, type ComponentType } from "react";
import { ToolTitleBar } from "@unimatrix/chrome/tool";

import { findPrototype, loadPrototype } from "@/lib/prototype-registry";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; Component: ComponentType }
  | { status: "error"; message: string };

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
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const entry = findPrototype(prototypeId);

  useEffect(() => {
    let cancelled = false;

    loadPrototype(prototypeId)
      .then((module) => {
        if (!cancelled) {
          setState({ status: "ready", Component: module.default });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
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

      {state.status === "loading" ? (
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
