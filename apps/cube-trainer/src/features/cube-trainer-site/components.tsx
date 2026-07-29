import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { RiArrowLeftLine } from "@remixicon/react";

import { Button, cn } from "@unimatrix/ui/public";

/**
 * The row that opens a view: a back control, the view's `h1`, and whatever
 * that view puts opposite them.
 *
 * Four places rendered this by hand — Learn and Drill, each in its session view
 * and its case-picker view — with the same wrapper, the same icon button, and
 * the same heading classes, differing only in the heading text and where "back"
 * goes. It stays app-local rather than moving to `@unimatrix/ui` because
 * nothing outside cube-trainer opens a view this way.
 *
 * `back` is a discriminated pair rather than a `ReactNode`: every call site
 * either routes home or steps a local mode back, and taking the button as a
 * slot would let a caller ship one without an accessible name.
 */
export function ToolTitleBar({
  actions,
  back,
  title,
}: {
  actions?: React.ReactNode;
  back: { label: string } & ({ onClick: () => void } | { to: string });
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {"to" in back ? (
          <Button asChild aria-label={back.label} size="icon" variant="outline">
            <Link to={back.to}>
              <RiArrowLeftLine aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        ) : (
          <Button aria-label={back.label} onClick={back.onClick} size="icon" variant="outline">
            <RiArrowLeftLine aria-hidden="true" className="size-4" />
          </Button>
        )}
        <h1 className="text-xl font-medium tracking-[-0.03em] text-foreground">{title}</h1>
      </div>

      {actions === undefined ? null : <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function AppPageContainer({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col gap-8 px-4 py-4 sm:px-6 lg:gap-10 lg:px-8 lg:py-6",
        className,
      )}
      {...props}
    />
  );
}

export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="py-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground/70">
        <p>
          ©{" "}
          <a
            className="underline decoration-muted-foreground/35 underline-offset-4 transition-colors hover:text-foreground"
            href="https://unimatrix-01.dev/"
            rel="noreferrer"
            target="_blank"
          >
            {year} Gwen Phalan
          </a>
        </p>
        <p>
          <a
            className="underline decoration-muted-foreground/35 underline-offset-4 transition-colors hover:text-foreground"
            href="https://github.com/unimatrixcore/unimatrix-01/tree/main/apps/cube-trainer"
            rel="noreferrer"
            target="_blank"
          >
            GitHub source
          </a>{" "}
          · Algorithm data from{" "}
          <a
            className="underline decoration-muted-foreground/35 underline-offset-4 transition-colors hover:text-foreground"
            href="https://jperm.net/algs"
            rel="noreferrer"
            target="_blank"
          >
            jperm.net/algs
          </a>
        </p>
      </div>
    </footer>
  );
}
