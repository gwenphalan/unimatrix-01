import { useEffect, useState, type ComponentType } from "react";

import { loadPrototype } from "@/lib/prototype-registry";

// Every variant carries the id it belongs to. Without that, changing
// `prototypeId` leaves the PREVIOUS component rendering under the new title
// until the new import resolves — a stale sketch shown as if it were the one
// asked for, which is worse than a blank frame.
type LoadState =
  | { status: "loading"; id: string }
  | { status: "ready"; id: string; Component: ComponentType }
  | { status: "error"; id: string; message: string };

/**
 * Renders one prototype, full viewport, contributing nothing to the screen.
 *
 * The harness draws no chrome around a running prototype — no title bar, no
 * footer, not even a back link, because the browser already has one. Everything
 * visible is the sketch. A wrapper makes the sketch answer for space it does not
 * own, and when the sketch *is* chrome — a shell's section nav, say — the
 * wrapper actively contradicts it. A prototype that wants the tool shell imports
 * `ToolShell` itself.
 *
 * `useState` + `useEffect` rather than `React.lazy` + `Suspense`: a prototype
 * that fails to load is the normal case here — a half-written sketch, a missing
 * default export, a stale import after a shared component moved — and an error
 * boundary that renders a blank screen would make every one of those look the
 * same. The message names the file.
 */
export function PrototypeHostPage({ prototypeId }: { prototypeId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading", id: prototypeId });

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

  if (state.id !== prototypeId || state.status === "loading") {
    return <HostMessage>Loading {prototypeId}…</HostMessage>;
  }

  if (state.status === "error") {
    return (
      <HostMessage>
        <span className="border border-destructive/45 px-4 py-3 font-mono text-sm text-destructive">
          {state.message}
        </span>
      </HostMessage>
    );
  }

  return <state.Component />;
}

function HostMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
