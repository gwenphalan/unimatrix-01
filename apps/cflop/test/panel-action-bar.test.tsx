import { fireEvent, render, screen } from "@testing-library/react";
import { RiArrowRightLine } from "@remixicon/react";
import { describe, expect, it, vi } from "vitest";

import { PanelActionBar } from "@/features/algorithms/components/panel-action-bar";

/**
 * These assert that both branches are in the DOM and behave, not which one the user sees: jsdom
 * does not evaluate media queries, so `pointer-coarse:hidden` has no effect here. Which branch is
 * visible on a given device is a browser question, covered by the Playwright smoke suite.
 */
describe("PanelActionBar", () => {
  it("names a navigate button by its label and activates it on click", () => {
    const onActivate = vi.fn();

    render(
      <PanelActionBar
        actions={[{ icon: RiArrowRightLine, kind: "navigate", label: "Next", onActivate }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("renders an act action as a short word beside its full key hint", () => {
    const onActivate = vi.fn();

    render(
      <PanelActionBar
        actions={[
          {
            keyLabel: "Space",
            kind: "act",
            label: "Mark learned",
            onActivate,
            shortLabel: "Learned",
          },
        ]}
      />,
    );

    // The full label stays in the hint - the button's visible word is its accessible name.
    expect(screen.getByText("Mark learned")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Learned" }));

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("renders both pointer branches for every action", () => {
    render(
      <PanelActionBar
        actions={[
          { icon: RiArrowRightLine, kind: "navigate", label: "Next", onActivate: () => {} },
          {
            keyLabel: "Space",
            kind: "act",
            label: "Next case",
            onActivate: () => {},
            shortLabel: "Next",
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(document.querySelectorAll("[data-panel-action]")).toHaveLength(2);
    expect(document.querySelectorAll(".pointer-coarse\\:hidden")).toHaveLength(2);
  });
});
