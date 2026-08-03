import { createLazyFileRoute } from "@tanstack/react-router";
import { RiArticleLine } from "@remixicon/react";

import { NotBuiltPlaceholder } from "@/features/sections/not-built-placeholder";

export const Route = createLazyFileRoute("/content")({
  component: ContentRoute,
});

// Ungated like every other section route today — `ADMIN_SECTIONS` in
// `@unimatrix/auth` names only `content` as gate-eligible, and this route has
// nothing behind it yet for that gate to protect. It gains the gate when the
// CMS actually moves onto this origin.
function ContentRoute() {
  return <NotBuiltPlaceholder icon={RiArticleLine} label="Content" />;
}
