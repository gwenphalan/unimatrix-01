import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usePermissions = vi.fn();

vi.mock("@unimatrix/auth/react", () => ({
  usePermissions,
}));

/**
 * The gate, exercised in both builds.
 *
 * `admin-slot.tsx` resolves its implementation at module scope from
 * `VITE_CLERK_PUBLISHABLE_KEY`, so each case re-imports the module after
 * stubbing the env — the same pattern as `require-auth.test.tsx` and
 * `api-client.disabled.test.ts`.
 *
 * What these assert is that nothing admin renders for a non-admin. They
 * cannot assert that no admin *chunk* is fetched, because vitest does not
 * code-split — that claim is checked against the real production build in
 * `public-ui-usage.test.ts` and by hand in DevTools.
 */
describe("AdminSlot", () => {
  beforeEach(() => {
    vi.resetModules();
    usePermissions.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing and reads no permissions when auth is disabled", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", undefined);

    const { AdminSlot } = await import("@/features/admin/admin-slot");
    const { container } = render(<AdminSlot kind="page" />);

    expect(container).toBeEmptyDOMElement();
    // Not incidental: calling Clerk's hook in a build with no `AuthProvider`
    // mounted is exactly the crash the module-scope resolution avoids.
    expect(usePermissions).not.toHaveBeenCalled();
  });

  it("reports no access when auth is disabled", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", undefined);

    const { useAdminAccess } = await import("@/features/admin/admin-slot");

    expect(readAccess(useAdminAccess)).toEqual({ isLoaded: true, isAdmin: false });
  });

  it("renders nothing for a signed-in user without the admin role", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_admin_slot");
    usePermissions.mockReturnValue({ isLoaded: true, isAdmin: () => false });

    const { AdminSlot } = await import("@/features/admin/admin-slot");
    const { container } = render(<AdminSlot kind="post-controls" slug="a-post" type="blog" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while Clerk is still loading, even if isAdmin() answers true", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_admin_slot");
    // Clerk reports `isLoaded: false` with an empty user before the session
    // resolves, so `isAdmin()` answering true here would be answering about
    // nobody. Rendering on it would flash admin controls at every visitor.
    usePermissions.mockReturnValue({ isLoaded: false, isAdmin: () => true });

    const { AdminSlot, useAdminAccess } = await import("@/features/admin/admin-slot");
    const { container } = render(<AdminSlot kind="page" />);

    expect(container).toBeEmptyDOMElement();
    expect(readAccess(useAdminAccess)).toEqual({ isLoaded: false, isAdmin: false });
  });

  it("reports access for a loaded admin", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_admin_slot");
    usePermissions.mockReturnValue({ isLoaded: true, isAdmin: () => true });

    const { useAdminAccess } = await import("@/features/admin/admin-slot");

    expect(readAccess(useAdminAccess)).toEqual({ isLoaded: true, isAdmin: true });
  });
});

/** Renders a hook once and returns what it produced. */
function readAccess(useAdminAccess: () => { isLoaded: boolean; isAdmin: boolean }) {
  let result: { isLoaded: boolean; isAdmin: boolean } | undefined;

  function Probe() {
    result = useAdminAccess();

    return null;
  }

  render(<Probe />);

  return result;
}
