import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  RiArticleLine,
  RiArrowRightSLine,
  RiFolderLine,
  RiHome5Line,
  RiLoginBoxLine,
  RiUserLine,
} from "@remixicon/react";
import { SignedIn, SignedOut, UserButton } from "@unimatrix/auth/react";

import { AdminSlot } from "@/features/admin/admin-slot";
import { PublicPageContainer, PublicSiteFooter } from "@/features/public-site/components";
import { isAuthEnabled, loadWebRuntimeConfig } from "@/lib/config";
import { CircuitField, CircuitOccluderProvider, cn } from "@unimatrix/ui/public";

const runtimeConfig = loadWebRuntimeConfig({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_AUTH_APP_URL: import.meta.env.VITE_AUTH_APP_URL,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
});
const authEnabled = isAuthEnabled(runtimeConfig);

type AppShellProps = {
  children: ReactNode;
};

const STICKY_BAR_TOP_OFFSET = 12;

const navItems = [
  {
    exact: true,
    icon: RiHome5Line,
    label: "Home",
    to: "/" as const,
  },
  {
    exact: false,
    icon: RiFolderLine,
    label: "Projects",
    to: "/projects" as const,
  },
  {
    exact: false,
    icon: RiArticleLine,
    label: "Blog",
    to: "/blog" as const,
  },
  {
    exact: false,
    icon: RiUserLine,
    label: "About",
    to: "/about" as const,
  },
];

type BreadcrumbItem = {
  label: string;
  to?: "/" | "/about" | "/projects" | "/blog";
};

function isNavItemActive(pathname: string, exact: boolean, to: (typeof navItems)[number]["to"]) {
  return exact ? pathname === to : pathname.startsWith(to);
}

/**
 * Below `sm` only the leading crumb survives, so the narrow header reads as
 * the site name beside the logo rather than a trail — the nav tabs already
 * carry which page is current. Every segment stays in the DOM and is hidden
 * with a responsive class so this stays a pure CSS breakpoint rather than a
 * JS-measured one; hiding a whole segment takes its leading separator with
 * it, which is why no separator is left dangling on mobile.
 *
 * Rendered as a real `nav` landmark, with the home logo link inside it. It was
 * a plain `div` beside a bare `Link`, and in the condensed header — which is
 * not inside `header` — that left both outside any landmark, which is what
 * axe's `region` rule reports. `nav[aria-label="Breadcrumb"]` is also just the
 * correct markup for a breadcrumb trail.
 *
 * `label` exists because both header bars render one of these, and two
 * landmarks sharing a role and an accessible name is exactly what
 * `landmark-unique` reports.
 */
function Breadcrumbs({
  items,
  label,
  logoClassName,
}: {
  items: BreadcrumbItem[];
  label: string;
  logoClassName: string;
}) {
  return (
    <nav
      aria-label={label}
      // `flex-nowrap` is load-bearing. The logo and the trail live in one flex
      // line; letting that line wrap drops the logo onto a row of its own at
      // 640-768px, where the trail is long enough to need the space. Measured:
      // with `flex-wrap` here the header's breadcrumb grew from 24px to 102px
      // tall at 640px and the trail broke across three lines. Wrapping belongs
      // on the inner trail span, which already has it, so only the crumbs move.
      className="flex min-w-0 flex-1 flex-nowrap items-center gap-2.5 text-sm text-muted-foreground"
    >
      <Link aria-label="Unimatrix-01 home" to="/">
        <img alt="" className={logoClassName} src="/logo.png" />
      </Link>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <span
              className={cn(
                "flex min-w-0 items-center gap-1",
                index === 0 ? undefined : "hidden sm:flex",
              )}
              key={`${item.to ?? "current"}:${item.label}:${index}`}
            >
              {index > 0 ? (
                <RiArrowRightSLine aria-hidden="true" className="size-3.5 shrink-0" />
              ) : null}
              {isLast || !item.to ? (
                <span className="truncate font-medium text-foreground">{item.label}</span>
              ) : (
                <Link className="truncate transition-colors hover:text-foreground" to={item.to}>
                  {item.label}
                </Link>
              )}
            </span>
          );
        })}
      </span>
    </nav>
  );
}

function buildSignInHref(): string {
  const redirectUrl = encodeURIComponent(window.location.href);

  return `${runtimeConfig.authAppUrl}/sign-in?redirect_url=${redirectUrl}`;
}

/**
 * Header sign-in affordance. Renders nothing when Clerk auth is disabled
 * (the default for this public site) — `SignedIn`/`SignedOut` are Clerk
 * components that require a mounted `AuthProvider`, so they must never be
 * rendered when one isn't present.
 */
function AuthHeaderAction() {
  if (!authEnabled) {
    return null;
  }

  return (
    <>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
      <SignedOut>
        <a
          className="inline-flex items-center gap-2 border border-border bg-secondary/60 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-foreground/75 transition-colors hover:border-primary/35 hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:outline-none"
          href={buildSignInHref()}
        >
          <RiLoginBoxLine aria-hidden="true" className="size-3.5" />
          <span>Sign in</span>
        </a>
      </SignedOut>
    </>
  );
}

// Nothing here registers a circuit occluder any more: `CircuitOccluderProvider`
// scans the DOM and registers whatever visually paints over the background,
// which covers this header, the condensed bar, the footer, and every card
// without a per-component call. Two decisions that used to be spelled out here
// now fall out of that scan: `main` still does not occlude (it paints nothing),
// and the condensed bar occludes only while visible (its wrapper is `opacity-0`
// and `inert` when hidden, so the scan prunes the subtree).
//
// `headerRef` survives for the scroll-condense measurement below, not for
// occlusion.
function AppShellContent({ children }: AppShellProps) {
  const headerRef = useRef<HTMLElement | null>(null);
  const [isCondensed, setIsCondensed] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  /**
   * Title of the entry the detail routes loaded, used by the breadcrumb.
   *
   * Read from the active match's loader data rather than from a slug lookup:
   * entries live in the database now, so the shell has no synchronous index to
   * consult, and the detail route has already resolved exactly this entry. The
   * breadcrumb falls back to the slug while the loader is still in flight.
   */
  const activeEntryTitle = useRouterState({
    select: (state) => {
      for (const match of state.matches) {
        const loaderData = match.loaderData as { frontmatter?: { title?: unknown } } | undefined;
        const title = loaderData?.frontmatter?.title;

        if (typeof title === "string") {
          return title;
        }
      }

      return undefined;
    },
  });

  useEffect(() => {
    const updateCollapsedState = () => {
      const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0;

      setIsCondensed(headerBottom <= STICKY_BAR_TOP_OFFSET);
    };

    updateCollapsedState();
    window.addEventListener("scroll", updateCollapsedState, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateCollapsedState);
    };
  }, []);

  const breadcrumbItems = useMemo(() => {
    const items: BreadcrumbItem[] = [{ label: "Unimatrix-01", to: "/" }];

    if (pathname === "/") {
      items.push({ label: "Home" });
      return items;
    }

    if (pathname === "/about") {
      items.push({ label: "About" });
      return items;
    }

    if (pathname === "/projects") {
      items.push({ label: "Projects" });
      return items;
    }

    if (pathname.startsWith("/projects/")) {
      const slug = pathname.replace("/projects/", "");

      items.push({ label: "Projects", to: "/projects" });
      items.push({ label: activeEntryTitle ?? slug });
      return items;
    }

    if (pathname === "/blog") {
      items.push({ label: "Blog" });
      return items;
    }

    if (pathname.startsWith("/blog/")) {
      const slug = pathname.replace("/blog/", "");

      items.push({ label: "Blog", to: "/blog" });
      items.push({ label: activeEntryTitle ?? slug });
      return items;
    }

    return items;
  }, [activeEntryTitle, pathname]);

  return (
    <PublicPageContainer>
      <CircuitField routeKey={pathname} />

      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:border focus:border-primary/45 focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        Skip to main content
      </a>

      <header className="site-panel site-shell overflow-hidden" ref={headerRef}>
        {/* One flex line that wraps instead of two nested clusters: below
            `sm` the nav is pushed to its own row by `w-full` + `order-last`,
            which leaves the title row free for the auth action. DOM order
            stays title → nav → auth so desktop tab order matches what's on
            screen. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:flex-nowrap lg:px-8 lg:py-5">
          <Breadcrumbs items={breadcrumbItems} label="Breadcrumb" logoClassName="size-6 shrink-0" />

          <nav
            aria-label="Primary"
            className="order-last grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end sm:order-none"
          >
            {navItems.map(({ icon: Icon, label, to, exact }) => {
              const active = isNavItemActive(pathname, exact, to);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex w-full items-center justify-center gap-2 border px-3 py-1.5 text-sm font-medium transition-[border-color,background-color,color] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/45 sm:w-auto",
                    active
                      ? "border-primary/45 bg-primary/12 text-foreground"
                      : "border-border bg-secondary/60 text-foreground/75 hover:border-primary/35 hover:bg-secondary hover:text-foreground",
                  )}
                  key={to}
                  to={to}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>

          {authEnabled ? (
            <div className="flex shrink-0 items-center justify-end gap-2">
              <AdminSlot kind="nav-link" />
              <AuthHeaderAction />
            </div>
          ) : null}
        </div>
      </header>

      {/* `opacity-0 pointer-events-none` hides this bar from sight and from
          the mouse, but not from the keyboard: before `inert`, tabbing an
          unscrolled page walked an invisible duplicate of the entire nav.
          `inert` removes it from the tab order and the accessibility tree
          while it is hidden, and gives it back — fully interactive — the
          moment it is shown. `aria-hidden` alone would be wrong here: it
          hides content from assistive technology while leaving it focusable,
          which is a WCAG 4.1.2 failure rather than a fix. */}
      <div
        className={cn(
          "fixed top-3 inset-x-0 z-40 transition-opacity duration-300 ease-out",
          isCondensed ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        inert={!isCondensed}
      >
        <div className="mx-auto w-full max-w-[92rem] px-4 sm:px-6 lg:px-8 xl:px-10">
          <div className="site-panel site-shell overflow-hidden border-primary/45 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_35%,transparent),0_18px_48px_-32px_color-mix(in_oklab,var(--primary)_35%,transparent)] px-3 py-2 lg:px-4 lg:py-2">
            {/* This bar keeps an `lg` nav breakpoint while the main header
                uses `sm`. Below `lg` the nav is already `order-last w-full`,
                so the auth action sits on the title row at every stacked
                width — the user-visible fix holds. Switching this to `sm`
                was tried and reverted: at 640px the full breadcrumb, four
                tabs, and the auth action do not fit this fixed overlay, and
                the trail truncates to "Uni… > B… > P…" across three lines. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-nowrap">
              <Breadcrumbs
                items={breadcrumbItems}
                label="Breadcrumb, condensed header"
                logoClassName="size-5 shrink-0"
              />

              <nav
                aria-label="Primary, condensed header"
                className="order-last grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:justify-end lg:order-none"
              >
                {navItems.map(({ icon: Icon, label, to, exact }) => {
                  const active = isNavItemActive(pathname, exact, to);

                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex w-full items-center justify-center gap-2 border px-3 py-1 text-sm font-medium transition-[border-color,background-color,color] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/45 lg:w-auto",
                        active
                          ? "border-primary/45 bg-primary/12 text-foreground"
                          : "border-border/70 bg-background/72 text-muted-foreground hover:border-primary/35 hover:text-foreground",
                      )}
                      key={to}
                      to={to}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </nav>

              {authEnabled ? (
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <AdminSlot kind="nav-link" />
                  <AuthHeaderAction />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <main id="main-content" className="-mt-4 grid flex-1 gap-8 lg:-mt-5 lg:gap-10">
        {children}
      </main>

      <PublicSiteFooter />

      {/* Mounted once, here, rather than beside each admin control: every
          admin action reports through one toast host, and two hosts would
          render two stacks. Nothing for a non-admin — the slot returns null
          and loads no chunk. */}
      <AdminSlot kind="toaster" />
    </PublicPageContainer>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <CircuitOccluderProvider>
      <AppShellContent>{children}</AppShellContent>
    </CircuitOccluderProvider>
  );
}
