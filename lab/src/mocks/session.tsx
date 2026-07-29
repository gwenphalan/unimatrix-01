import type { AppSlug, Role, UserPermissionsMetadata } from "@unimatrix/auth";
import { APP_SLUGS, hasPermission } from "@unimatrix/auth";
import { Avatar, AvatarFallback } from "@unimatrix/ui";

/**
 * A stand-in for a Clerk session.
 *
 * The permission half is typed against `@unimatrix/auth`'s `.` entry — the
 * framework-agnostic permission scheme — rather than against
 * `@unimatrix/shared`, which carries no session or permission types at all.
 * That import is deliberate and narrow: adding a slug to `APP_SLUGS` or a role
 * to `ROLES` breaks these fixtures at typecheck, which is exactly the property
 * the mocks exist for, and the `.` entry is dependency-free code with no
 * transport and no Clerk client in it.
 *
 * `@unimatrix/auth/react` and `@unimatrix/auth/server` are banned by name in
 * `eslint.config.mjs` and have no alias in `vite.config.ts` or `tsconfig.json`.
 * The lab prototypes a signed-in view with no Clerk keys; the moment it holds a
 * real session it stops being able to make that claim.
 */
export interface LabSession {
  userId: string;
  fullName: string;
  primaryEmail: string;
  /** Rendered by {@link MockAccountControl}; Clerk derives its own from the name. */
  initials: string;
  permissions: UserPermissionsMetadata;
}

/**
 * Holds `admin` on every slug in `APP_SLUGS`, derived rather than hand-listed.
 *
 * A literal object here drifts silently: a slug added to `APP_SLUGS` is simply
 * absent from this fixture, `hasPermission` returns false for it, and the
 * prototype renders the unauthorized view with nothing failing. `admin` was
 * already missing this way. Building from `APP_SLUGS` makes the doc comment
 * true by construction instead of by maintenance.
 */
export const labAdminSession: LabSession = {
  userId: "user_lab_admin",
  fullName: "Lab Admin",
  primaryEmail: "admin@lab.invalid",
  initials: "LA",
  permissions: {
    permissions: Object.fromEntries(
      APP_SLUGS.map((slug: AppSlug) => [slug, ["admin"] satisfies Role[]]),
    ),
  },
};

/** Signed in, no elevated roles. Use this to check what a normal user sees. */
export const labViewerSession: LabSession = {
  userId: "user_lab_viewer",
  fullName: "Lab Viewer",
  primaryEmail: "viewer@lab.invalid",
  initials: "LV",
  permissions: {
    permissions: {
      web: ["viewer"],
    },
  },
};

/**
 * Signed out. `null` rather than a flag on {@link LabSession}, so a prototype
 * has to handle the absent case the same way a real one does.
 */
export const labSignedOutSession = null;

/**
 * Whether `session` grants `role` for `appSlug`.
 *
 * The real `hasPermission` from `@unimatrix/auth`, not a reimplementation — a
 * mock that answers permission questions differently from production is worse
 * than no mock, because the view it produces is one nobody will ever see.
 */
export function labSessionHasPermission(
  session: LabSession | null,
  appSlug: AppSlug,
  role: Role,
): boolean {
  return session !== null && hasPermission(session.permissions, appSlug, role);
}

/**
 * Stands in for Clerk's `<UserButton />` in the `accountControl` slot of
 * `@unimatrix/chrome`'s shells. Non-interactive on purpose: there is nothing to
 * sign out of.
 */
export interface MockAccountControlProps {
  session: LabSession | null;
}

export function MockAccountControl({ session }: MockAccountControlProps) {
  if (session === null) {
    return <span className="text-sm text-muted-foreground">Signed out (mock)</span>;
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{session.fullName}</span>
      <Avatar className="size-8">
        <AvatarFallback className="text-xs">{session.initials}</AvatarFallback>
      </Avatar>
    </span>
  );
}
