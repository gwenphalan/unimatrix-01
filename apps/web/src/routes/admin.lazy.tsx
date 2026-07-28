import { Outlet, createLazyFileRoute } from "@tanstack/react-router";

import { AdminSlot, useAdminAccess } from "@/features/admin/admin-slot";
import { PublicNotice, PublicSectionHeading } from "@/features/public-site/components";

export const Route = createLazyFileRoute("/admin")({
  component: AdminLayout,
});

/**
 * Layout for the whole `/admin` subtree.
 *
 * Everything under `/admin` renders inside the admin dashboard chrome rather
 * than the public site's header and footer — see `AdminShell`. That chrome
 * lives in the admin chunk, so a non-admin never downloads it; they get the
 * public shell (chosen in `__root.tsx`) around the notice below instead.
 *
 * The gate cannot live in `beforeLoad` — reading the permission is a hook — and
 * it does not need to: nothing of substance is reachable without rendering
 * `AdminSlot`'s dynamic import.
 */
function AdminLayout() {
  const { isLoaded, isAdmin } = useAdminAccess();

  if (isAdmin) {
    return (
      <AdminSlot kind="shell">
        <Outlet />
      </AdminSlot>
    );
  }

  if (!isLoaded) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PublicSectionHeading headingLevel={1} title="Admin" />
      <PublicNotice
        description="This page manages the site's blog posts and projects. Sign in with an admin account to use it."
        label="Restricted"
        title="You do not have access to this page."
      />
    </div>
  );
}
