import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { RiSidebarFoldLine, RiSidebarUnfoldLine } from "@remixicon/react";

import { Button, cn } from "@unimatrix/ui/public";

import { ToolFooterLink } from "./tool-shell.js";

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
 * caller.
 */
export function ToolSectionRail({
  accountControl,
  collapsed,
  footerEnd,
  homeHref,
  homeLabel,
  logoSrc,
  onToggleCollapsed,
  ownerName,
  sections,
  sectionsHomeHref,
  sectionsLabel,
}: {
  accountControl?: ReactNode;
  collapsed: boolean;
  footerEnd?: ReactNode;
  homeHref: string | undefined;
  homeLabel: string | undefined;
  logoSrc: string;
  onToggleCollapsed: () => void;
  ownerName: string;
  sections: readonly ToolSection[];
  sectionsHomeHref: string;
  sectionsLabel: string;
}) {
  const year = new Date().getFullYear();
  const copyright = `${year} ${ownerName}`;

  return (
    <div
      className={cn(
        // Flush to the viewport edge and full height: this is application
        // chrome, not a card on a page. Only the content region beside it gets
        // the shell's centred, padded container.
        "flex shrink-0 flex-col gap-4 border-r border-border/60 bg-background/70 p-3 backdrop-blur-sm",
        collapsed ? "w-16" : "w-56",
      )}
    >
      {/* Wordmark and toggle share a row while there is width for it, and stack
          once collapsed — a 64px rail cannot hold both side by side. */}
      <div
        className={cn(
          "flex items-center justify-between gap-2",
          collapsed && "flex-col justify-start",
        )}
      >
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
            "flex min-w-0 items-center gap-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            collapsed && "justify-center",
          )}
          to={sectionsHomeHref}
        >
          <img alt="" className="size-6 shrink-0" src={logoSrc} />
          <span className={cn("truncate", collapsed && "sr-only")}>{homeLabel}</span>
        </Link>

        <Button
          aria-label={collapsed ? "Expand sections" : "Collapse sections"}
          className="shrink-0"
          onClick={onToggleCollapsed}
          size="icon"
          variant="ghost"
        >
          {collapsed ? (
            <RiSidebarUnfoldLine aria-hidden="true" className="size-4" />
          ) : (
            <RiSidebarFoldLine aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>

      <nav aria-label={sectionsLabel} className="flex flex-1 flex-col gap-1">
        {sections.map((section) => {
          const Icon = section.icon;

          return (
            <Link
              aria-current={section.active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors",
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

      {/* Sibling of `nav`, not nested inside it — a `<footer>` scoped inside a
          `<nav>` (or any `article`/`aside`/`main`/`section`) maps to no
          landmark at all per HTML-AAM, so nesting it here would silently drop
          the rail's `contentinfo` role in a real browser. */}
      <footer className="flex flex-col gap-3 border-t border-border/60 pt-3">
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
              "flex min-w-0 items-center overflow-hidden",
              collapsed && "justify-center [&>*]:block [&>*]:max-w-full [&>*]:truncate",
            )}
          >
            {accountControl}
          </div>
        )}
        <p className={cn("text-xs text-muted-foreground/70", collapsed && "sr-only")}>
          ©{" "}
          {homeHref === undefined ? (
            copyright
          ) : (
            <ToolFooterLink href={homeHref}>{copyright}</ToolFooterLink>
          )}
        </p>
        {footerEnd === undefined ? null : (
          <p className={cn("text-xs text-muted-foreground/70", collapsed && "sr-only")}>
            {footerEnd}
          </p>
        )}
      </footer>
    </div>
  );
}
