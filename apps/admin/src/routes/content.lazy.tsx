import { Outlet, createLazyFileRoute } from "@tanstack/react-router";
import { canAccessAdminSection } from "@unimatrix/auth";
import { usePermissions } from "@unimatrix/auth/react";
import { Toaster } from "@unimatrix/ui";

import { AdminAccessDenied } from "@/features/content/content-panel";

export const Route = createLazyFileRoute("/content")({
  component: ContentRoute,
});

/**
 * The only gated section today. `usePermissions().permissions` is
 * `UserPermissionsMetadata["permissions"]`, so wrapping it in `{ permissions }`
 * satisfies `canAccessAdminSection`'s first parameter directly.
 *
 * `<Toaster />` is mounted here rather than in `AppShell`: publish, delete and
 * upload are the only actions in this app that report errors through a toast,
 * and this is the one section that reaches `@unimatrix/ui`'s root barrel — the
 * other six stay on `NotBuiltPlaceholder` from `./public`.
 */
function ContentRoute() {
  const { isLoaded, permissions } = usePermissions();
  const { runtimeConfig } = Route.useRouteContext();

  if (!isLoaded) {
    return null;
  }

  return (
    <>
      {canAccessAdminSection({ permissions }, "content") ? (
        <Outlet />
      ) : (
        <AdminAccessDenied authAppUrl={runtimeConfig.authAppUrl} />
      )}
      <Toaster position="bottom-right" />
    </>
  );
}
