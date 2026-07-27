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

import {
  getBlogEntryBySlug,
  getProjectEntryBySlug,
} from "@/features/content/site-content";
import { PublicPageContainer, PublicSiteFooter } from "@/features/public-site/components";
import { isAuthEnabled, loadWebRuntimeConfig } from "@/lib/config";
import { useIsNarrowViewport } from "@/lib/use-media-query";
import {
  CircuitField,
  CircuitOccluderProvider,
  cn,
  useCircuitOccluder,
} from "@unimatrix/ui/public";

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
 */
function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <span
            className={cn("flex min-w-0 items-center gap-1", index === 0 ? undefined : "hidden sm:flex")}
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
    </div>
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

// `useCircuitOccluder` calls must live in a component rendered *inside*
// `CircuitOccluderProvider`, not the component that creates the provider —
// a component can't consume a context it renders as its own descendant.
function AppShellContent({ children }: AppShellProps) {
  const headerRef = useRef<HTMLElement | null>(null);
  const condensedHeaderRef = useRef<HTMLDivElement | null>(null);
  const [isCondensed, setIsCondensed] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  // Narrow viewports skip the circuit field entirely — unmounted, not
  // CSS-hidden, so no traces are generated and no animation loop runs.
  const isNarrowViewport = useIsNarrowViewport();

  useCircuitOccluder(headerRef);
  // `main` itself is no longer registered — it's a window-scrolling
  // container spanning full page content, which would blanket most of the
  // viewport at a flat weight regardless of what's actually on the page.
  // Negative-space routing instead comes from registering the real
  // rectangular content blocks inside it (cards, article panels, the
  // footer) — see `PublicSiteFooter`/`PublicLinkedSurface` and the
  // route-level article panels.
  // Only occlude while the condensed bar is actually visible — it's always
  // mounted (opacity-toggled, not conditionally rendered), so an
  // unconditional registration would occlude this strip even when hidden.
  useCircuitOccluder(condensedHeaderRef, { enabled: isCondensed });

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
      const project = getProjectEntryBySlug(slug);

      items.push({ label: "Projects", to: "/projects" });
      items.push({ label: project?.frontmatter.title ?? slug });
      return items;
    }

    if (pathname === "/blog") {
      items.push({ label: "Blog" });
      return items;
    }

    if (pathname.startsWith("/blog/")) {
      const slug = pathname.replace("/blog/", "");
      const entry = getBlogEntryBySlug(slug);

      items.push({ label: "Blog", to: "/blog" });
      items.push({ label: entry?.frontmatter.title ?? slug });
      return items;
    }

    return items;
  }, [pathname]);

  return (
    <PublicPageContainer>
      {isNarrowViewport ? null : <CircuitField routeKey={pathname} />}

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
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Link aria-label="Unimatrix-01 home" to="/">
              <img alt="" className="size-6 shrink-0" src="/logo.png" />
            </Link>
            <Breadcrumbs items={breadcrumbItems} />
          </div>

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
              <AuthHeaderAction />
            </div>
          ) : null}
        </div>
      </header>

      <div
        className={cn(
          "fixed top-3 inset-x-0 z-40 transition-opacity duration-300 ease-out",
          isCondensed
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
        <div className="mx-auto w-full max-w-[92rem] px-4 sm:px-6 lg:px-8 xl:px-10">
          <div
            className="site-panel site-shell overflow-hidden border-primary/45 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_35%,transparent),0_18px_48px_-32px_color-mix(in_oklab,var(--primary)_35%,transparent)] px-3 py-2 lg:px-4 lg:py-2"
            ref={condensedHeaderRef}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Link aria-label="Unimatrix-01 home" to="/">
                  <img alt="" className="size-5 shrink-0" src="/logo.png" />
                </Link>
                <Breadcrumbs items={breadcrumbItems} />
              </div>

              <nav
                aria-label="Primary"
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
