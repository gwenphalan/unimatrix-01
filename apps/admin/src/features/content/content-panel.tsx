import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";

/**
 * A titled panel inside the Content section, used for each managed collection
 * and for the editor page.
 */
export function AdminPanel({
  actions,
  children,
  className,
  description,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  title: string;
}) {
  const headingId = useId();

  return (
    // A labelled `section` is a landmark: with two of these side by side, the
    // heading is what tells a screen-reader user which collection's controls
    // they are in.
    <section aria-labelledby={headingId} className={className}>
      <div className="site-panel flex min-h-0 flex-1 flex-col gap-4 px-5 py-5 lg:px-6 lg:py-6">
        {/* `items-center`, not `items-start`: the heading's cap height and a
            small button's box do not start at the same y, so aligning their
            tops left them visibly a couple of pixels out of line. */}
        {/* A rule under the header, not just the column gap: the panel's own
            border is the only other line on the card, so without it the title
            reads as the first row of the content rather than its heading. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="space-y-1">
            <h2
              className="text-lg leading-tight font-medium tracking-[-0.03em] text-foreground"
              id={headingId}
            >
              {title}
            </h2>
            {description === undefined ? null : (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </div>

        {children}
      </div>
    </section>
  );
}

/** Shown in place of the Content section for a visitor without `auth:admin`. */
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
