import { render, screen, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This route test isn't about auth, but `app-shell.tsx` (rendered by every
// route via the router) reads VITE_CLERK_PUBLISHABLE_KEY at module scope —
// stubbed explicitly unset here so the test matches the default,
// auth-disabled build regardless of whatever a developer's own local
// `.env.local` configures for real Clerk testing. `app-shell.tsx` and its
// dependents must be freshly (re-)imported after stubbing, not imported
// statically at file top.
describe("about route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the /about route with contact details and an email draft form", async () => {
    const { Providers } = await import("@/app/providers");
    const { createAppRouter } = await import("@/app/router");
    const { createAppQueryClient } = await import("@/lib/query-client");

    const queryClient = createAppQueryClient();
    const router = createAppRouter({
      history: createMemoryHistory({
        initialEntries: ["/about"],
      }),
      queryClient,
    });

    render(
      <Providers client={queryClient}>
        <RouterProvider router={router} />
      </Providers>,
    );

    await act(async () => {
      await router.load();
    });

    expect(
      await screen.findByText(
        "Draft an email",
      ),
    ).toBeInTheDocument();

    const main = screen.getByRole("main");

    expect(
      await within(main).findByText("gwen.phalan@unimatrix-01.dev"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open email draft/i })).toBeInTheDocument();
  });
});
