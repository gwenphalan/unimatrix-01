import { createLazyFileRoute } from "@tanstack/react-router";
import { RiMegaphoneLine } from "@remixicon/react";

import { NotBuiltPlaceholder } from "@/features/sections/not-built-placeholder";

export const Route = createLazyFileRoute("/social")({
  component: SocialRoute,
});

function SocialRoute() {
  return <NotBuiltPlaceholder icon={RiMegaphoneLine} label="Social" />;
}
