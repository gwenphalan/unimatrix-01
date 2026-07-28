import { RiArrowRightSLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { UserButton } from "@unimatrix/auth/react";
import { Toaster } from "@unimatrix/ui/editor";
import { CircuitField, CircuitOccluderProvider } from "@unimatrix/ui/public";
import { useId, type ReactNode } from "react";

import { useApiClient } from "@/lib/api-client";

import { adminPostsQueryOptions } from "./queries";

/**
 * Chrome for the whole `/admin` subtree.
 *
 * Deliberately not the public site's header and footer. The nav tabs and the
 * marketing footer are wayfinding for someone deciding what to read; this is a
 * surface someone came to *use*, so it gets application chrome instead — a
 * title bar naming the tool, one way back out, the account control, and a dense
 * content region that owns the rest of the viewport.
 *
 * The circuit field stays. It is the site's visual identity rather than page
 * furniture, and `CircuitOccluderProvider` measures what actually paints, so
 * the panels here register themselves without a per-component call.
 *
 * Everything below lives in the admin chunk, reached through `AdminSlot`'s
 * single dynamic import — a non-admin never downloads this file.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <CircuitOccluderProvider>
      {/* Viewport-height only from `lg` up. The fill-the-viewport frame is what
          makes this read as an application rather than a page, but it only
          works while the content fits: on a phone the editor's fields alone are
          taller than the viewport, and a fixed-height frame turns that into a
          zero-height editor with the submit buttons painted over it. Below `lg`
          the frame grows and the page scrolls, which is what a phone does
          anyway. */}
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[92rem] flex-col gap-4 px-4 py-4 sm:px-6 lg:h-[100dvh] lg:px-8 lg:py-6 xl:px-10">
        <CircuitField routeKey="admin" />

        {/* Carried over from the public shell rather than dropped with the rest
            of it: losing the skip link would be a real accessibility regression
            on the subtree, not a page-furniture difference. */}
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:border focus:border-primary/45 focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
          href="#admin-content"
        >
          Skip to main content
        </a>

        <header className="site-panel site-shell overflow-hidden px-5 py-4 lg:px-8 lg:py-5">
          {/* Deliberately not wrapping. The trail truncates instead, so the
              account control stays on the title bar's own line at any width —
              wrapping it onto a second row made the chrome taller than the
              first field of the form below it on a phone. */}
          <div className="flex items-center justify-between gap-4">
            <AdminBreadcrumbs />
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col" id="admin-content">
          {children}
        </main>

        {/* The admin subtree does not render `AppShell`, which is where the
            site's only other toast host lives. Without this every publish,
            delete and upload failure would report into nothing — and toasts are
            the *only* error reporting those paths have. Exactly one host is
            mounted at a time because the two shells are mutually exclusive. */}
        <Toaster position="bottom-right" />
      </div>
    </CircuitOccluderProvider>
  );
}

/**
 * Location trail, and the only global way out of the tool.
 *
 * This replaced a "Back to website" button in the chrome, which was solving
 * the wrong problem in the wrong place. Two different exits were being
 * conflated: "show me the post I just published", which is frequent and wants
 * a *specific* page, and "I'm done here", which is rare and wants the site
 * root. A single button served the second badly and the first not at all,
 * while occupying the top-right slot that belongs to the account control.
 *
 * The frequent exit is now the per-row "View" link in the table, where the
 * post it refers to actually is. The rare one is the leading crumb — the site
 * name, which is the exit every CMS of this shape uses (Ghost, WordPress and
 * Shopify admin all lean on the site identity rather than a dedicated button).
 * The middle crumb doubles as the way back to the dashboard root from the
 * editor pages, which a lone "back to website" button could not express at all.
 */
function AdminBreadcrumbs() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search });
  const client = useApiClient();

  const isEditing = pathname.startsWith("/admin/posts/edit");
  // The edited post's title names the crumb, so the editor panel below does not
  // have to repeat it in a heading: the post's own Title field is right there.
  // Read from the admin list the editor page is already using — cached on the
  // common path in from the dashboard — so this costs no extra request, and
  // falls back to the generic label while it loads.
  const { data } = useQuery({ ...adminPostsQueryOptions(client), enabled: isEditing });
  const editedId = (search as { id?: string }).id;
  const editedTitle = data?.posts.find((post) => post.id === editedId)?.title;

  const trail = pathname.startsWith("/admin/posts/new")
    ? "New post"
    : isEditing
      ? editedTitle === undefined
        ? "Edit post"
        : `Edit ${editedTitle}`
      : null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-nowrap items-center gap-2.5 text-sm text-muted-foreground"
    >
      {/* A plain anchor, not a router `Link`: leaving the tool is a document
          navigation out of the admin subtree, and routing it client-side would
          keep the admin chunk resident for the rest of the visit. */}
      <a aria-label="Unimatrix-01 home" href="/">
        <img alt="" className="size-6 shrink-0" src="/logo.png" />
      </a>
      <span className="flex min-w-0 items-center gap-1">
        {/* The site name never truncates and never hides. It is the way out of
            the tool, and a trail whose every segment is clipped — "Unimatrix… ›
            Adm… › New p…", which is what a phone gave — names nothing and
            leads nowhere. What gives instead is the middle crumb, below `sm`:
            the editor already has Cancel, so the dashboard is not stranded. */}
        <a className="shrink-0 transition-colors hover:text-foreground" href="/">
          Unimatrix-01
        </a>
        <RiArrowRightSLine aria-hidden="true" className="size-3.5 shrink-0" />
        {trail === null ? (
          <span className="truncate font-medium text-foreground">Admin</span>
        ) : (
          <>
            <span className="hidden min-w-0 items-center gap-1 sm:flex">
              <Link className="truncate transition-colors hover:text-foreground" to="/admin">
                Admin
              </Link>
              <RiArrowRightSLine aria-hidden="true" className="size-3.5 shrink-0" />
            </span>
            <span className="truncate font-medium text-foreground">{trail}</span>
          </>
        )}
      </span>
    </nav>
  );
}

/**
 * A titled panel inside {@link AdminShell}, used for each managed collection
 * and for the editor page.
 */
export function AdminPanel({
  actions,
  children,
  className,
  description,
  leading,
  title,
  titleHidden = false,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  /** Rendered to the left of the heading, on the heading's own row. */
  leading?: ReactNode;
  title: string;
  /**
   * Keeps the heading as the section's accessible name but takes it off the
   * screen. For a panel whose title only repeats what the breadcrumb above and
   * the content below already say — the post editor — where showing it costs a
   * line of the viewport and tells a sighted reader nothing new.
   */
  titleHidden?: boolean;
}) {
  const headingId = useId();

  return (
    // A labelled `section` is a landmark: with two of these side by side, the
    // heading is what tells a screen-reader user which collection's controls
    // they are in.
    <section aria-labelledby={headingId} className={className}>
      <div className="site-panel flex min-h-0 flex-col gap-4 px-5 py-5 lg:px-6 lg:py-6">
        {/* `items-center`, not `items-start`: the heading's cap height and a
            small button's box do not start at the same y, so aligning their
            tops left them visibly a couple of pixels out of line. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {leading}
            <div className="space-y-1">
              <h2
                className={
                  titleHidden
                    ? "sr-only"
                    : "text-lg leading-tight font-medium tracking-[-0.03em] text-foreground"
                }
                id={headingId}
              >
                {title}
              </h2>
              {description === undefined ? null : (
                <p className="text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {actions}
        </div>

        {children}
      </div>
    </section>
  );
}

/** Shown in place of the admin surface for a visitor without `auth:admin`. */
export function AdminAccessDenied() {
  return (
    <div className="site-panel space-y-3 px-5 py-5 lg:px-6 lg:py-6">
      <h2 className="text-lg font-medium text-foreground">You do not have access to this page.</h2>
      <p className="text-sm text-muted-foreground">
        This tool manages the site&rsquo;s blog posts and projects. Sign in with an admin account to
        use it.
      </p>
      <Link className="text-sm text-primary underline underline-offset-4" to="/">
        Return to the site
      </Link>
    </div>
  );
}
