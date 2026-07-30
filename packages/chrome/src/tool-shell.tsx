import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { RiArrowLeftLine } from "@remixicon/react";

import { Button, GraphBackground, cn } from "@unimatrix/ui/public";

/**
 * The desktop-app shell every tool, dashboard, and admin surface in this repo
 * gets. It is deliberately *not* the public site's chrome: no nav tabs, no site
 * footer, no breadcrumb trail. A tool owns its own navigation, so all this
 * provides is the frame — page container, background field, skip link, an
 * optional title bar carrying the account control and the way back to the
 * public site, and a thin attribution footer.
 *
 * Auth is a slot, not a dependency. `accountControl` takes whatever the service
 * wants there (a Clerk `UserButton`, a sign-in link, nothing at all), which is
 * what keeps this package free of `@unimatrix/auth`: `apps/cflop` is a
 * public, sign-in-free tool and must not gain an auth dependency by importing
 * its shell. The public shell in `./public` takes the same slot for the same
 * reason.
 */

export type ToolShellProps = {
  /**
   * Rendered at the right of the title bar. When this and `homeHref` are both
   * absent no title bar is rendered at all, and the shell is container +
   * field + main + footer.
   */
  accountControl?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /**
   * Right-hand cluster of the footer — source links, data attribution, and
   * anything else that is specific to this tool. Use `ToolFooterLink` for the
   * links so the styling stays here rather than being copied per service.
   */
  footerEnd?: React.ReactNode;
  /**
   * Absolute URL of the public site. Rendered as the wordmark's link in the
   * title bar and as the copyright link in the footer — the "way back to the
   * public site" a tool shell owes its user.
   */
  homeHref?: string;
  /** Wordmark shown in the title bar beside `homeHref`. */
  homeLabel?: string;
  /** Name in the footer's copyright line. */
  ownerName?: string;
};

const DEFAULT_OWNER_NAME = "Gwen Phalan";

export function ToolPageContainer({ className, ...props }: React.ComponentProps<"div">) {
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

/**
 * The row that opens a view: a back control, the view's `h1`, and whatever that
 * view puts opposite them.
 *
 * `back` is a discriminated pair rather than a `ReactNode`: every call site
 * either routes somewhere or steps a local mode back, and taking the button as
 * a slot would let a caller ship one without an accessible name.
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

/**
 * External link in the tool footer. Exists so a service adds its own
 * attribution without re-deriving the underline and hover treatment.
 */
export function ToolFooterLink({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "underline decoration-muted-foreground/35 underline-offset-4 transition-colors hover:text-foreground",
        className,
      )}
      rel="noreferrer"
      target="_blank"
      {...props}
    />
  );
}

function ToolFooter({
  end,
  homeHref,
  ownerName,
}: {
  end: React.ReactNode | undefined;
  homeHref: string | undefined;
  ownerName: string;
}) {
  const year = new Date().getFullYear();
  const copyright = `${year} ${ownerName}`;

  return (
    <footer className="py-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground/70">
        <p>
          ©{" "}
          {homeHref === undefined ? (
            copyright
          ) : (
            <ToolFooterLink href={homeHref}>{copyright}</ToolFooterLink>
          )}
        </p>
        {end === undefined ? null : <p>{end}</p>}
      </div>
    </footer>
  );
}

export function ToolShell({
  accountControl,
  children,
  className,
  footerEnd,
  homeHref,
  homeLabel,
  ownerName = DEFAULT_OWNER_NAME,
}: ToolShellProps) {
  // A tool with neither an account control nor a wordmark has nothing to put in
  // a title bar, and an empty bar would only cost vertical space. `apps/cflop`
  // is that case today, which is why migrating it onto this shell is a no-op on
  // screen rather than a redesign.
  const hasTitleBar = accountControl !== undefined || homeLabel !== undefined;

  return (
    <ToolPageContainer className={className}>
      <GraphBackground />

      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:border focus:border-primary/45 focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        Skip to main content
      </a>

      {hasTitleBar ? (
        <div className="flex items-center justify-between gap-4">
          {homeLabel === undefined ? (
            <span />
          ) : (
            <a
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              href={homeHref}
            >
              {homeLabel}
            </a>
          )}
          {accountControl === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2">{accountControl}</div>
          )}
        </div>
      ) : null}

      <main className="flex flex-1 flex-col justify-center gap-8 lg:gap-10" id="main-content">
        {children}
      </main>

      <ToolFooter end={footerEnd} homeHref={homeHref} ownerName={ownerName} />
    </ToolPageContainer>
  );
}
