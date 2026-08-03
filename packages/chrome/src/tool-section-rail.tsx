import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { RiSidebarFoldLine, RiSidebarUnfoldLine } from "@remixicon/react";

import { Button, cn } from "@unimatrix/ui/public";

/**
 * Narrower than the icon libraries' own prop types, same as `PublicNavIcon`
 * in `./public-shell.tsx` and for the same two reasons: it is the only
 * surface this file uses, and under `exactOptionalPropertyTypes` a class
 * component's `defaultProps` — which is how Remix icons are typed — is
 * checked against this shape, so a target without `| undefined` on every
 * prop rejects them.
 */
export type ToolSectionIcon = ComponentType<{
  "aria-hidden"?: boolean | "true" | "false" | undefined;
  className?: string | undefined;
}>;

/**
 * One entry in a tool's section rail. `to` plus a plain `active` boolean,
 * never `href` or `activeOptions`: an `href` renders a plain `<a>` and
 * full-reloads out of the SPA, and computing the active match here would put
 * route knowledge in the package rather than the app that owns it.
 */
export type ToolSection = {
  active: boolean;
  icon?: ToolSectionIcon;
  label: string;
  to: string;
};

/**
 * The collapsible vertical rail `ToolShell` renders in place of its title bar
 * and footer strip when it is given `sections`. Holds no state of its own —
 * `collapsed` and `onToggleCollapsed` come from `ToolShell`, which is its only
 * caller. `ToolShell` also owns the footer strip itself: this rail renders
 * only the wordmark, the toggle, the section nav, and the account control.
 */
export function ToolSectionRail({
  accountControl,
  collapsed,
  homeLabel,
  logoSrc,
  onToggleCollapsed,
  sections,
  sectionsHomeHref,
  sectionsLabel,
}: {
  accountControl?: ReactNode;
  collapsed: boolean;
  homeLabel: string | undefined;
  logoSrc: string;
  onToggleCollapsed: () => void;
  sections: readonly ToolSection[];
  sectionsHomeHref: string;
  sectionsLabel: string;
}) {
  return (
    <div
      className={cn(
        // Flush to the viewport edge and full height: this is application
        // chrome, not a card on a page. Only the content region beside it gets
        // the shell's centred, padded container. `relative` is load-bearing
        // for the toggle below — it must not gain `overflow-hidden`, or the
        // part of the toggle that overhangs the right edge is clipped.
        "relative flex shrink-0 flex-col gap-4 border-r border-border/60 bg-background/70 p-3 backdrop-blur-sm",
        collapsed ? "w-16" : "w-56",
      )}
    >
      {/* Floats outside the rail's own flow so it can straddle the right
          border rather than sharing a row (and the wordmark's width) with the
          wordmark. `top-3` matches the rail's `p-3` padding, and both this
          button and the wordmark link below are `h-9`, so their centres land
          on the same line. `-right-4` centres the button (`size-icon`, 36px)
          on the border: 16px of it sits outside the rail, 20px inside. The
          position is relative to the rail's own edge, so it does not move
          when the rail's width changes between collapsed and expanded. */}
      <Button
        aria-label={collapsed ? "Expand sections" : "Collapse sections"}
        className="absolute -right-4 top-3 z-10 bg-background"
        onClick={onToggleCollapsed}
        size="icon"
        variant="outline"
      >
        {collapsed ? (
          <RiSidebarUnfoldLine aria-hidden="true" className="size-4" />
        ) : (
          <RiSidebarFoldLine aria-hidden="true" className="size-4" />
        )}
      </Button>

      <Link
        // On the route the wordmark points at, this link and that section's
        // link both report `aria-current="page"`. It cannot be suppressed
        // from here: `Link` spreads its own `aria-current` after every
        // caller-supplied prop, including `activeProps`. Two current links
        // is a smell rather than a violation, and the alternative — a plain
        // `<a>` — trades it for a full document reload on a same-origin
        // route. Same trade the public shell's logo link already makes.
        aria-label={homeLabel}
        className={cn(
          "flex h-9 min-w-0 items-center gap-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
          collapsed && "justify-center",
        )}
        to={sectionsHomeHref}
      >
        <img alt="" className="size-6 shrink-0" src={logoSrc} />
        {/* Collapsed, the logo is the whole affordance — the wordmark is not
            hidden, it is not rendered. `aria-label` already carries the name,
            so a screen reader loses nothing, and an `sr-only` copy of the
            same string beside it would be dead markup either way. */}
        {collapsed ? null : <span className="truncate">{homeLabel}</span>}
      </Link>

      <nav aria-label={sectionsLabel} className="flex flex-1 flex-col gap-1">
        {sections.map((section) => {
          const Icon = section.icon;

          return (
            <Link
              aria-current={section.active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-sm px-3 text-sm transition-colors",
                collapsed && "justify-center px-2",
                section.active
                  ? "bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              key={section.to}
              title={section.label}
              to={section.to}
            >
              {Icon === undefined ? null : <Icon aria-hidden="true" className="size-4 shrink-0" />}
              <span className={cn("truncate", collapsed && "sr-only")}>{section.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* The slot is a `ReactNode` the package cannot measure or restyle, and
          collapsed the rail is narrower than plenty of plausible controls —
          Clerk's signed-in `<UserButton />` is an avatar that fits, its
          signed-out button is text that does not. Without this the control
          escapes the rail on both sides and paints over the content region.
          `block` is doing real work: a slot rendering an inline `<a>` ignores
          `max-width` entirely, so clipping it needs a block box first. */}
      {accountControl === undefined ? null : (
        <div
          className={cn(
            "flex min-w-0 items-center overflow-hidden border-t border-border/60 pt-3",
            collapsed && "justify-center [&>*]:block [&>*]:max-w-full [&>*]:truncate",
          )}
        >
          {accountControl}
        </div>
      )}
    </div>
  );
}
