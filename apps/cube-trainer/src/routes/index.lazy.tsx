import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { RiBookOpenLine, RiFlashlightLine } from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";

export const Route = createLazyFileRoute("/")({
  component: IndexRoute,
});

const MODES = [
  { icon: RiBookOpenLine, label: "Learn", to: "/learn" as const },
  { icon: RiFlashlightLine, label: "Drill", to: "/drill" as const },
];

// The tile is discovered as an occluder automatically: `.site-panel` paints,
// and the wrapping `div` — not the `Link` inside it — is the element that
// carries that class, so what registers is still the surface rather than the
// interactive element.
function ModeTile({
  icon: Icon,
  label,
  to,
}: {
  icon: RemixiconComponentType;
  label: string;
  to: "/learn" | "/drill";
}) {
  return (
    <div className="site-panel site-panel-strong h-40">
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
      <div className="flex items-center justify-center text-center">
        <div className="flex items-center gap-3">
          <img alt="" className="size-9 shrink-0 opacity-90" src="/favicon.svg" />
          <h1 className="text-3xl font-medium tracking-[-0.03em] text-foreground">Cube Trainer</h1>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MODES.map(({ icon, label, to }) => (
          <ModeTile icon={icon} key={to} label={label} to={to} />
        ))}
      </div>
    </div>
  );
}
