import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { RiBookOpenLine, RiFlashlightLine } from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { useRef } from "react";

import { useCircuitOccluder } from "@unimatrix/ui/public";

export const Route = createLazyFileRoute("/")({
  component: IndexRoute,
});

const MODES = [
  { icon: RiBookOpenLine, label: "Learn", to: "/learn" as const },
  { icon: RiFlashlightLine, label: "Drill", to: "/drill" as const },
];

// Each tile registers itself as an occluder — a hook can't be called per
// iteration of a `.map()`, so this is its own component instead. The
// occluder ref lives on the wrapping `div`, not the `Link` itself: circuit
// occluders are meant for non-interactive surfaces (panels, cards,
// footers), never for interactive elements like links/buttons, even one
// that's visually a card. The `Link` stays the full-size click target
// inside it.
function ModeTile({
  icon: Icon,
  label,
  to,
}: {
  icon: RemixiconComponentType;
  label: string;
  to: "/learn" | "/drill";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useCircuitOccluder(ref);

  return (
    <div className="site-panel site-panel-strong h-40" ref={ref}>
      <Link
        className="flex h-full w-full flex-col items-center justify-center gap-3 text-center transition-colors hover:bg-primary/8"
        to={to}
      >
        <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
        <span className="text-lg font-medium tracking-[-0.02em] text-foreground">{label}</span>
      </Link>
    </div>
  );
}

function IndexRoute() {
  return (
    <div className="space-y-10">
      <div className="flex items-center justify-center gap-3 text-center">
        <img alt="" className="size-9 shrink-0 opacity-90" src="/favicon.svg" />
        <h1 className="text-3xl font-medium tracking-[-0.03em] text-foreground">Cube Trainer</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MODES.map(({ icon, label, to }) => (
          <ModeTile icon={icon} key={to} label={label} to={to} />
        ))}
      </div>
    </div>
  );
}
