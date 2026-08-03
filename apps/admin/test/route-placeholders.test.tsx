import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Route as AnalyticsRoute } from "../src/routes/analytics.lazy.js";
import { Route as DeploysRoute } from "../src/routes/deploys.lazy.js";
import { Route as FeedbackRoute } from "../src/routes/feedback.lazy.js";
import { Route as SecretsRoute } from "../src/routes/secrets.lazy.js";
import { Route as SocialRoute } from "../src/routes/social.lazy.js";

/**
 * The five still-unbuilt section routes render the same placeholder with a
 * different label. One assertion each is enough to prove the route wires the
 * right label through, not a repeat of `NotBuiltPlaceholder`'s own test.
 * Content is not here — it has its own gate and its own tests now that the
 * CMS has moved onto this origin.
 */
const ROUTES = [
  { Route: FeedbackRoute, label: "Feedback" },
  { Route: DeploysRoute, label: "Deploys" },
  { Route: AnalyticsRoute, label: "Analytics" },
  { Route: SocialRoute, label: "Social" },
  { Route: SecretsRoute, label: "Secrets" },
];

describe("unbuilt section routes", () => {
  for (const { Route, label } of ROUTES) {
    it(`${label} renders its not-built-yet placeholder`, () => {
      const Component = Route.options.component;

      if (Component === undefined) {
        throw new Error(`${label} route has no component`);
      }

      render(<Component />);

      expect(screen.getByText(`${label} has not been built yet.`)).toBeInTheDocument();
    });
  }
});
