import { createLazyFileRoute } from "@tanstack/react-router";
import { RiFeedbackLine } from "@remixicon/react";

import { NotBuiltPlaceholder } from "@/features/sections/not-built-placeholder";

export const Route = createLazyFileRoute("/feedback")({
  component: FeedbackRoute,
});

function FeedbackRoute() {
  return <NotBuiltPlaceholder icon={RiFeedbackLine} label="Feedback" />;
}
