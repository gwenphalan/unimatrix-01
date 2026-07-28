import { createLazyFileRoute } from "@tanstack/react-router";

import { AdminSlot, useAdminAccess } from "@/features/admin/admin-slot";
import { PublicNotice, PublicSectionHeading } from "@/features/public-site/components";

export const Route = createLazyFileRoute("/admin")({
  component: AdminRoute,
});

/**
 * `/admin` is a normal route that renders nothing of substance for anyone
 * without `auth:admin`. The gate cannot live in `beforeLoad` — reading the
 * permission is a hook — and it does not need to: the admin UI is behind
 * `AdminSlot`'s dynamic import, so a non-admin never downloads it.
 */
function AdminRoute() {
  const { isLoaded, isAdmin } = useAdminAccess();

  return (
    <div className="space-y-6">
      <PublicSectionHeading headingLevel={1} title="Admin" />

      {isAdmin ? (
        <AdminSlot kind="page" />
      ) : isLoaded ? (
        <PublicNotice
          description="This page manages the site's blog posts and projects. Sign in with an admin account to use it."
          label="Restricted"
          title="You do not have access to this page."
        />
      ) : null}
    </div>
  );
}
