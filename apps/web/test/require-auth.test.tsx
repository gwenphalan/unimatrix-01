import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// VITE_CLERK_PUBLISHABLE_KEY is explicitly stubbed unset (not just left
// alone), matching the default, auth-disabled build regardless of whatever
// a developer's own local `.env.local` configures for real Clerk testing:
// `RequireAuth` must render its children unchanged and must never redirect,
// since there is nothing to protect against without a configured Clerk key.
// `require-auth.tsx` reads the env var at module scope, so the module must
// be freshly (re-)imported after stubbing, not imported statically at file
// top — mirrors `api-client.disabled.test.ts`'s established pattern.
describe("RequireAuth (auth disabled)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders children without redirecting", async () => {
    const { RequireAuth } = await import("@/features/auth/require-auth");

    render(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});
