import { expect, test, type Page } from "@playwright/test";

import {
  collectPageErrors,
  expectNoAccessibilityViolations,
  expectNoPageErrors,
  gotoRoute,
} from "@unimatrix/e2e-helpers";

/**
 * Empty, and meant to stay that way. This list held `heading-order`, which fired
 * inside the "Choose cases" picker: its `h1` was followed by `h3` group labels.
 * Those are `h2` now, so the baseline is a hard floor rather than a backlog.
 *
 * Adding an entry here should be a deliberate, explained edit. It means shipping
 * a known structural problem, and it is the kind of change that is easy to make
 * quietly to turn a build green.
 *
 * It stays app-local rather than moving into `@unimatrix/e2e-helpers` alongside
 * the scanner: a baseline shared with apps/web would let a suppression added for
 * one app silently lower the floor for the other.
 */
const KNOWN_BEST_PRACTICE_VIOLATIONS: readonly string[] = [];

async function scanAccessibility(page: Page, routeLabel: string) {
  await expectNoAccessibilityViolations(page, routeLabel, KNOWN_BEST_PRACTICE_VIOLATIONS);
}

test("homepage load", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const main = page.locator("main");

  await gotoRoute(page, "/");

  await expect(main.getByRole("heading", { name: "CFLOP" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Learn" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Drill" })).toBeVisible();

  await scanAccessibility(page, "/");
  expectNoPageErrors(pageErrors);
});

test("Drill flow: drill and case picker", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const main = page.locator("main");

  await gotoRoute(page, "/drill");

  await expect(main.getByRole("heading", { name: "Drilling" })).toBeVisible();
  await expect(main.getByText("Next case")).toBeVisible();

  const previewModes = main.getByRole("radiogroup", { name: "Preview mode" });

  // Two-sided is PLL-only, so it must not be offered while OLL is selected.
  await expect(previewModes.getByRole("radio", { name: "2-Side" })).toBeHidden();

  await main
    .getByRole("radiogroup", { name: "Algorithm set" })
    .getByRole("radio", { name: "PLL" })
    .click();

  await previewModes.getByRole("radio", { name: "2-Side" }).click();
  await expect(main.getByRole("img")).toBeVisible();

  await main.getByRole("button", { name: "Choose cases" }).click();
  await expect(main.getByRole("heading", { name: "Choose cases" })).toBeVisible();
  await expect(main.getByRole("button", { name: "PLL Ua", exact: true })).toBeVisible();

  await scanAccessibility(page, "/drill");
  expectNoPageErrors(pageErrors);
});

test("the algorithm set carries from Learn to Drill", async ({ page }) => {
  const main = page.locator("main");

  await gotoRoute(page, "/learn");
  await main
    .getByRole("radiogroup", { name: "Algorithm set" })
    .getByRole("radio", { name: "PLL" })
    .click();

  await gotoRoute(page, "/drill");

  await expect(
    main.getByRole("radiogroup", { name: "Algorithm set" }).getByRole("radio", { name: "PLL" }),
  ).toBeChecked();
});

/**
 * axe covers only one pointer branch per run, and the two coverages are disjoint: Playwright's
 * desktop context is `pointer: fine`, and Lighthouse audits in mobile emulation. Without these the
 * coarse-pointer buttons are scanned by nothing.
 */
test.describe("coarse pointer", () => {
  test.use({ hasTouch: true });

  test("Drill offers an on-screen Next", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const main = page.locator("main");

    await gotoRoute(page, "/drill");

    await expect(main.getByRole("button", { name: "Next", exact: true })).toBeVisible();

    await scanAccessibility(page, "/drill (coarse pointer)");
    expectNoPageErrors(pageErrors);
  });

  test("Learn offers on-screen navigation and a learned control", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const main = page.locator("main");

    await gotoRoute(page, "/learn");

    await expect(main.getByRole("button", { name: "Learned", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Next", exact: true })).toBeVisible();

    await scanAccessibility(page, "/learn (coarse pointer)");
    expectNoPageErrors(pageErrors);
  });
});

test("Learn flow: guided session and case picker", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const main = page.locator("main");

  await gotoRoute(page, "/learn");

  await expect(main.getByRole("heading", { name: "Learning" })).toBeVisible();
  await expect(main.getByText("Mark learned")).toBeVisible();

  await main
    .getByRole("radiogroup", { name: "Algorithm set" })
    .getByRole("radio", { name: "PLL" })
    .click();

  await main.getByRole("button", { name: "Choose cases" }).click();
  await expect(main.getByRole("heading", { name: "Choose cases" })).toBeVisible();
  await expect(main.getByRole("button", { name: "PLL Gd", exact: true })).toBeVisible();

  await scanAccessibility(page, "/learn");
  expectNoPageErrors(pageErrors);
});
