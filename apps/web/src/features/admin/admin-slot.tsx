import type { ContentPostType } from "@unimatrix/shared";
import type { ReactNode } from "react";
import { Component, Suspense, lazy } from "react";
import { usePermissions } from "@unimatrix/auth/react";

import { isAuthEnabled, loadWebRuntimeConfig } from "@/lib/config";

const runtimeConfig = loadWebRuntimeConfig({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_AUTH_APP_URL: import.meta.env.VITE_AUTH_APP_URL,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
});

/**
 * The single dynamic import that separates the CMS from the public site.
 *
 * Everything the admin UI is made of — the table, the dialogs, the form, the
 * editor and CodeMirror underneath it — is reachable only through this
 * `import()`, so the bundler puts all of it in its own chunk. A visitor who is
 * not an admin never renders {@link AdminSlot}'s gated branch, so the browser
 * never requests that chunk: the admin surface is not delivered rather than
 * delivered-and-hidden.
 *
 * The chunk being *fetchable* by anyone who guesses its URL is inherent to a
 * static SPA and is fine — it contains code, not content. The real boundary is
 * `requirePermission("auth", "admin")` on every admin route in the API.
 */
const AdminSurface = lazy(async () => {
  const module = await import("./admin-surface");

  return { default: module.AdminSurface };
});

/**
 * Where an admin control is being asked for. One union rather than one
 * component per placement, so there is exactly one dynamic import to reason
 * about when asking what lands in the admin chunk.
 */
export type AdminSlotProps =
  /** Mounted once, in the public app shell: the toast host every admin action uses. */
  | { kind: "toaster" }
  /** Chrome for the whole `/admin` subtree, wrapped around the routed page. */
  | { kind: "shell"; children: ReactNode }
  /** The `/admin` index: bulk management of both collections. */
  | { kind: "page" }
  /** The full-page create/edit form. `postId` is `null` when creating. */
  | { kind: "post-form"; postId: string | null; type: ContentPostType }
  /** A "New blog post" / "New project" button for one collection. */
  | { kind: "new-post"; type: ContentPostType }
  /** Per-item edit / publish / delete controls, addressed the way a public page knows a post. */
  | { kind: "post-controls"; type: ContentPostType; slug: string };

/** What {@link useAdminAccess} reports about the current visitor. */
export interface AdminAccess {
  /** `false` until Clerk has resolved the session; nothing admin should render before then. */
  isLoaded: boolean;
  /** Whether the visitor holds `auth:admin`. */
  isAdmin: boolean;
}

const NO_ADMIN_ACCESS: AdminAccess = { isLoaded: true, isAdmin: false };

function useNoAdminAccess(): AdminAccess {
  return NO_ADMIN_ACCESS;
}

function useClerkAdminAccess(): AdminAccess {
  const { isLoaded, isAdmin } = usePermissions();

  return { isLoaded, isAdmin: isLoaded && isAdmin() };
}

/**
 * Whether to show admin affordances, resolved once at module scope from
 * build-time config rather than branched inside a component — the same shape
 * as `useApiClient` in `src/lib/api-client.ts`, and for the same reason.
 *
 * `usePermissions` calls Clerk's `useUser`, which needs an `AuthProvider`
 * above it, and `AuthBoundary` only mounts one when
 * `VITE_CLERK_PUBLISHABLE_KEY` is set. Picking the implementation here keeps
 * which hooks run identical across every render of a given build, in both the
 * auth-enabled and auth-disabled builds.
 *
 * This is a display gate, not a security one. It decides what a browser is
 * asked to render; it decides nothing about what the API will answer.
 */
export const useAdminAccess: () => AdminAccess = isAuthEnabled(runtimeConfig)
  ? useClerkAdminAccess
  : useNoAdminAccess;

function NoAdminSlot(): ReactNode {
  return null;
}

function GatedAdminSlot(props: AdminSlotProps): ReactNode {
  const { isAdmin } = useAdminAccess();

  if (!isAdmin) {
    return null;
  }

  return (
    <AdminSlotErrorBoundary>
      <Suspense fallback={null}>
        <AdminSurface {...props} />
      </Suspense>
    </AdminSlotErrorBoundary>
  );
}

/**
 * Renders admin controls for admins and nothing at all for everyone else.
 *
 * Safe to place anywhere on a public page: for a signed-out visitor — and in
 * any build without Clerk configured — this is a component that returns
 * `null` and imports nothing.
 */
export const AdminSlot: (props: AdminSlotProps) => ReactNode = isAuthEnabled(runtimeConfig)
  ? GatedAdminSlot
  : NoAdminSlot;

interface AdminSlotErrorBoundaryState {
  hasError: boolean;
}

/**
 * A failed admin chunk must not take the public page down with it. An admin
 * who sees no controls will notice; a reader who sees a blank article because
 * a chunk 404'd after a deploy would have no idea why.
 */
class AdminSlotErrorBoundary extends Component<
  { children: ReactNode },
  AdminSlotErrorBoundaryState
> {
  override state: AdminSlotErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AdminSlotErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}
