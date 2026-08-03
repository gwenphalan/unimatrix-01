import { createLazyFileRoute } from "@tanstack/react-router";
import { RiRocketLine } from "@remixicon/react";

import { NotBuiltPlaceholder } from "@/features/sections/not-built-placeholder";

export const Route = createLazyFileRoute("/deploys")({
  component: DeploysRoute,
});

function DeploysRoute() {
  return <NotBuiltPlaceholder icon={RiRocketLine} label="Deploys" />;
}
