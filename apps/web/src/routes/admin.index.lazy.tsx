import { createLazyFileRoute } from "@tanstack/react-router";

import { AdminSlot } from "@/features/admin/admin-slot";

export const Route = createLazyFileRoute("/admin/")({
  component: AdminIndexRoute,
});

/**
 * Only ever rendered inside the admin layout's gated branch, so the slot here
 * is the chunk boundary rather than a second permission check.
 */
function AdminIndexRoute() {
  return <AdminSlot kind="page" />;
}
