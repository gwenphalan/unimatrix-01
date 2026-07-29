import { Link, createLazyFileRoute } from "@tanstack/react-router";

import { AdminSlot } from "@/features/admin/admin-slot";
import {
  PublicNotice,
  PublicSectionHeading,
  PublicTransmissionListItem,
} from "@/features/public-site/components";

export const Route = createLazyFileRoute("/blog")({
  component: BlogRoute,
  errorComponent: BlogUnavailable,
});

function BlogRoute() {
  const entries = Route.useLoaderData();

  return (
    <div className="space-y-5">
      <PublicSectionHeading headingLevel={1} title="Blog" />

      <AdminSlot kind="new-post" type="blog" />

      {entries.length === 0 ? (
        <PublicNotice
          description="Nothing is published here yet. Check back once the first entry goes up."
          label="No posts yet"
          title="The blog is empty."
        />
      ) : (
        <div className="grid gap-3">
          {entries.map((entry, index) => (
            <div className="grid gap-3" key={entry.slug}>
              <PublicTransmissionListItem
                actions={
                  <AdminSlot kind="post-controls" part="actions" slug={entry.slug} type="blog" />
                }
                badge={
                  <AdminSlot kind="post-controls" part="badge" slug={entry.slug} type="blog" />
                }
                headingLevel={2}
                entry={entry}
                index={index + 1}
                renderLink={({ ariaLabel, children, className }) => (
                  <Link
                    aria-label={ariaLabel}
                    className={className}
                    params={{ slug: entry.slug }}
                    to="/blog/$slug"
                  >
                    {children}
                  </Link>
                )}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Posts are fetched from the API now, so an unreachable API is a real state
 * this page has to render — it used to be impossible, because the list was
 * compiled into the bundle.
 */
function BlogUnavailable() {
  return (
    <div className="space-y-5">
      <PublicSectionHeading headingLevel={1} title="Blog" />

      <PublicNotice
        description="The blog could not be loaded right now. Reload the page to try again."
        label="Unavailable"
        title="Posts could not be loaded."
        tone="destructive"
      />
    </div>
  );
}
