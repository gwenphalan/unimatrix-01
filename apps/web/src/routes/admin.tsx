import { createFileRoute, redirect } from "@tanstack/react-router";

// The CMS moved to its own origin (`apps/admin`, on `admin.unimatrix-01.dev`).
// This route only exists to catch anyone with the old `/admin` URL bookmarked
// or linked and send them to the new home. `href` (rather than `to`) makes
// this a full-document navigation, since the target is a different origin.
export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    redirect({ href: "https://admin.unimatrix-01.dev/", throw: true });
  },
});
