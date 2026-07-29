import { createFileRoute } from "@tanstack/react-router";

/**
 * No loader: every admin read needs an `auth:admin` session, and a route
 * loader runs before the component can tell whether the visitor has one. The
 * data is fetched inside the admin chunk instead, which only mounts for an
 * admin — so a signed-out visitor landing here makes no API call at all.
 */
export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Unimatrix-01 - Admin" },
      // Not a security control — the API is. This keeps a page that is useless
      // to the public out of search results.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
