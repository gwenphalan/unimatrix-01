import { Link } from "@tanstack/react-router";
import { RiArrowRightLine, RiFlaskLine } from "@remixicon/react";
import { Card } from "@unimatrix/ui/public";

import { prototypes } from "@/lib/prototype-registry";

/**
 * The index: a list of what is in `lab/prototypes/`, and nothing else.
 *
 * Not a component gallery, not a documentation site. Everything else this page
 * could grow — search, tags, a preview grid, a theme switcher — is work spent
 * on the harness instead of on the thing being designed.
 */
export function PrototypeIndexPage() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-medium tracking-[-0.03em] text-foreground">Prototypes</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          UX sketches against mock data. Drop a <code>.tsx</code> file with a default export into{" "}
          <code>lab/prototypes/</code> and it appears here.
        </p>
      </div>

      {prototypes.length === 0 ? <EmptyState /> : <PrototypeList />}
    </div>
  );
}

function PrototypeList() {
  return (
    <ul className="flex flex-col gap-2">
      {prototypes.map((entry) => (
        <li key={entry.id}>
          <Link
            className="group flex items-center justify-between gap-4 border border-border/60 bg-card/40 px-4 py-3 transition-colors hover:border-primary/45 hover:bg-card"
            params={{ _splat: entry.id }}
            to="/p/$"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{entry.title}</span>
              <span className="font-mono text-xs text-muted-foreground">{entry.sourcePath}</span>
            </span>
            <RiArrowRightLine
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-start gap-3 border-dashed p-6">
      <RiFlaskLine aria-hidden="true" className="size-5 text-muted-foreground" />
      <p className="text-sm text-foreground">No prototypes on this branch.</p>
      <p className="max-w-2xl text-sm text-muted-foreground">
        That is the expected state on <code>main</code>. Prototypes live on <code>lab/*</code>{" "}
        branches and are never merged — a required check fails any pull request to <code>main</code>{" "}
        whose diff touches <code>lab/prototypes/</code>. That is repo hygiene, not a security
        control: the lab is local-dev only, so a prototype reaching <code>main</code> costs clutter
        and rot, not exposure.
      </p>
    </Card>
  );
}
