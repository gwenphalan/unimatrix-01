import { fireEvent, render, screen } from "@testing-library/react";
import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";
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

  it("keeps an unavailable navigate action in the layout but out of the accessibility tree", () => {
    render(
      <PanelActionBar
        actions={[
          {
            available: false,
            icon: RiArrowLeftLine,
            kind: "navigate",
            label: "Back",
            onActivate: () => {},
          },
          {
            keyLabel: "Space",
            kind: "act",
            label: "Mark learned",
            onActivate: () => {},
            shortLabel: "Learned",
          },
          {
            available: true,
            icon: RiArrowRightLine,
            kind: "navigate",
            label: "Next",
            onActivate: () => {},
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    // The key hint is text rather than a role, so its own exclusion has to be asserted directly.
    expect(screen.getByText("Back").closest("span")).toHaveAttribute("aria-hidden", "true");

    // Reserved, not removed: the elements are still there holding the act control in place.
    expect(document.querySelectorAll("[data-panel-action]")).toHaveLength(3);
    expect(document.querySelectorAll(".invisible")).toHaveLength(2);
  });
});
