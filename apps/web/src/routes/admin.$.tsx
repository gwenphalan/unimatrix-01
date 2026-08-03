import { createFileRoute, redirect } from "@tanstack/react-router";

// Catches every deeper `/admin/*` path (e.g. an old `/admin/posts/edit` link).
// `admin.tsx` is this route's parent layout, so its `beforeLoad` already
// redirects every descendant match on its own — this file exists for
// belt-and-braces, not because it is load-bearing on its own.
export const Route = createFileRoute("/admin/$")({
  beforeLoad: () => {
    redirect({ href: "https://admin.unimatrix-01.dev/", throw: true });
  },
});
