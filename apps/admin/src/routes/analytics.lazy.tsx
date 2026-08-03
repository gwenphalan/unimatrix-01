import { createLazyFileRoute } from "@tanstack/react-router";
import { RiBarChartLine } from "@remixicon/react";

import { NotBuiltPlaceholder } from "@/features/sections/not-built-placeholder";

export const Route = createLazyFileRoute("/analytics")({
  component: AnalyticsRoute,
});

function AnalyticsRoute() {
  return <NotBuiltPlaceholder icon={RiBarChartLine} label="Analytics" />;
}
