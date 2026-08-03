import { useRouterState } from "@tanstack/react-router";
import {
  RiArticleLine,
  RiBarChartLine,
  RiDashboardLine,
  RiFeedbackLine,
  RiKeyLine,
  RiMegaphoneLine,
  RiRocketLine,
} from "@remixicon/react";
import type { ToolSection } from "@unimatrix/chrome/tool";

const SECTION_DEFINITIONS: readonly Omit<ToolSection, "active">[] = [
  { icon: RiDashboardLine, label: "Overview", to: "/" },
  { icon: RiArticleLine, label: "Content", to: "/content" },
  { icon: RiFeedbackLine, label: "Feedback", to: "/feedback" },
  { icon: RiRocketLine, label: "Deploys", to: "/deploys" },
  { icon: RiBarChartLine, label: "Analytics", to: "/analytics" },
  { icon: RiMegaphoneLine, label: "Social", to: "/social" },
  { icon: RiKeyLine, label: "Secrets", to: "/secrets" },
];

/**
 * The admin app's section rail, with `active` computed from the router's
 * current location. `/` needs an exact match — every other section is a
 * prefix match, so a future nested route under e.g. `/content/…` still marks
 * `Content` active.
 */
export function useAdminSections(): ToolSection[] {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return SECTION_DEFINITIONS.map((section) => ({
    ...section,
    active: section.to === "/" ? pathname === "/" : pathname.startsWith(section.to),
  }));
}
