import type { ReactNode } from "react";
import { useMemo } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  RiArticleLine,
  RiFolderLine,
  RiGithubLine,
  RiHome5Line,
  RiLoginBoxLine,
  RiMailLine,
  RiShieldUserLine,
  RiUserLine,
} from "@remixicon/react";
import { SignedIn, SignedOut, UserButton } from "@unimatrix/auth/react";
import type { PublicBreadcrumbItem, PublicNavItem } from "@unimatrix/chrome/public";
import { PublicFooterLink, PublicShell } from "@unimatrix/chrome/public";

import { AdminSlot, useAdminAccess } from "@/features/admin/admin-slot";
import { emailAddress, githubProfileUrl } from "@/features/public-site/site-links";
import { isAuthEnabled, loadWebRuntimeConfig } from "@/lib/config";

const runtimeConfig = loadWebRuntimeConfig({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_AUTH_APP_URL: import.meta.env.VITE_AUTH_APP_URL,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
});
const authEnabled = isAuthEnabled(runtimeConfig);

type AppShellProps = {
  children: ReactNode;
};

/**
 * Which routes exist and how a path maps onto a tab stays here rather than in
 * `@unimatrix/chrome`: the package renders the frame, the app owns the route
 * knowledge. `exact` is consumed by `isNavItemActive` below and never leaves
 * this file — the shell receives an already-resolved `active` flag.
 */
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

function isNavItemActive(pathname: string, exact: boolean, to: (typeof navItems)[number]["to"]) {
  return exact ? pathname === to : pathname.startsWith(to);
}

function buildSignInHref(): string {
  const redirectUrl = encodeURIComponent(window.location.href);

  return `${runtimeConfig.authAppUrl}/sign-in?redirect_url=${redirectUrl}`;
}

/**
 * Header sign-in affordance, passed to the shell as `accountControl`. It stays
 * in this app rather than moving into `@unimatrix/chrome` because it is the
 * whole reason the shell takes a slot: the package must not gain
 * `@unimatrix/auth`, or a sign-in-free tool could not import a shell from it.
 *
 * Renders nothing when Clerk auth is disabled (the default for this public
 * site) — `SignedIn`/`SignedOut` are Clerk components that require a mounted
 * `AuthProvider`, so they must never be rendered when one isn't present.
 *
 * The admin entry point lives in the `UserButton` menu rather than beside it:
 * it is an account-scoped affordance, not a site section, and the header
 * already carries four nav items.
 *
 * This is the one admin control that is **not** routed through `AdminSlot`.
 * Clerk resolves `UserButton`'s menu by inspecting its direct children for its
 * own `MenuItems`/`Link` component types, so the `Suspense` + error boundary
 * `AdminSlot` wraps everything in would leave the item silently undetected.
 * The cost is that the literal `"Admin"` and `/admin` ship in the public
 * bundle, which reveals nothing: `routeTree.gen.ts` is not lazy, so the
 * `/admin` route is already in every visitor's bundle. No admin *code* moves —
 * the page, controls, dialogs and editor all stay behind `AdminSlot`'s single
 * dynamic import.
 *
 * `useAdminAccess()` is called above the `authEnabled` early return so the hook
 * order is identical in both builds; in the no-Clerk build it resolves to a
 * hookless constant.
 */
function AuthHeaderAction() {
  const { isAdmin } = useAdminAccess();

  if (!authEnabled) {
    return null;
  }

  return (
    <>
      <SignedIn>
        {/* No `afterSignOutUrl` here — deprecated on the button, and
            `<ClerkProvider>` in `auth-boundary.tsx` already sets it. */}
        <UserButton>
          {isAdmin ? (
            <UserButton.MenuItems>
              <UserButton.Link
                href="/admin"
                label="Admin"
                labelIcon={<RiShieldUserLine aria-hidden="true" className="size-4" />}
              />
            </UserButton.MenuItems>
          ) : null}
        </UserButton>
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

/**
 * Contact and profile links for the site footer. Site data, not chrome, so the
 * shell takes them as a slot the same way it takes the account control.
 */
function SiteFooterLinks() {
  return (
    <>
      <PublicFooterLink href={`mailto:${emailAddress}`}>
        <RiMailLine aria-hidden="true" className="size-3.5" />
        {emailAddress}
      </PublicFooterLink>
      <PublicFooterLink href={githubProfileUrl} rel="noreferrer" target="_blank">
        <RiGithubLine aria-hidden="true" className="size-3.5" />
        github.com/gwenphalan
      </PublicFooterLink>
    </>
  );
}

export function AppShell({ children }: AppShellProps) {
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

  const breadcrumbItems = useMemo(() => {
    const items: PublicBreadcrumbItem[] = [{ label: "Unimatrix-01", to: "/" }];

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

  const shellNavItems = useMemo<PublicNavItem[]>(
    () =>
      navItems.map(({ exact, icon, label, to }) => ({
        active: isNavItemActive(pathname, exact, to),
        icon,
        label,
        to,
      })),
    [pathname],
  );

  return (
    <PublicShell
      // `undefined` rather than a rendered `null`: the shell drops the whole
      // right-hand cluster when there is no account control, and the no-Clerk
      // build must not pay for an empty flex child.
      accountControl={authEnabled ? <AuthHeaderAction /> : undefined}
      breadcrumbItems={breadcrumbItems}
      footerLinks={<SiteFooterLinks />}
      navItems={shellNavItems}
      // Mounted once, here, rather than beside each admin control: every admin
      // action reports through one toast host, and two hosts would render two
      // stacks. Nothing for a non-admin — the slot returns null and loads no
      // chunk. The shell takes it out of flow so it does not earn the column's
      // gap under the footer.
      trailing={<AdminSlot kind="toaster" />}
    >
      {children}
    </PublicShell>
  );
}
