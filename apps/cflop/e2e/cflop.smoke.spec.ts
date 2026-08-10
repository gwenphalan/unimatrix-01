import { expect, test, type Locator, type Page } from "@playwright/test";

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

/**
 * A panel action's key hint and its coarse-pointer button carry the same word, so `getByText`
 * resolves both and strict mode refuses the locator. The hint is the span holding the key glyph and
 * the button is the only thing with a button role, which is what lets each half be named on its
 * own — and asserting the button *hidden* is what makes this a check of the pointer branch rather
 * than of the string.
 */
async function expectFinePointerAction(main: Locator, label: string) {
  await expect(main.locator("span:has(kbd)").filter({ hasText: label })).toBeVisible();
  await expect(main.getByRole("button", { name: label, exact: true })).toBeHidden();
}

test("homepage load", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const main = page.locator("main");

  await gotoRoute(page, "/");

  await expect(main.getByRole("heading", { name: "CFLOP" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Learn" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Drill" })).toBeVisible();

  await scanAccessibility(page, "/");

  // Assert the tags were served before asserting they are gone. `count === 0`
  // on its own passes against any server that never emitted them — a dev server
  // reached through `reuseExistingServer`, or a build whose prerender step
  // silently did nothing. The pair is what makes the removal the thing measured.
  const servedHtml = await (await page.request.get("/")).text();
  expect(servedHtml).toContain("data-prerendered-head");

  // React owns the head once it mounts, so leaving any of it behind means two
  // of every meta and link.
  await expect(page.locator("[data-prerendered-head]")).toHaveCount(0);

  // The one real-browser check that React's `<title>` wins over the static one
  // the served file keeps. A stale tab title after a client navigation is the
  // symptom if it stops.
  await main.getByRole("link", { name: "Learn" }).click();
  await expect(page).toHaveTitle("CFLOP - Learn");

  expectNoPageErrors(pageErrors);
});

test("Drill flow: drill and case picker", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const main = page.locator("main");

  await gotoRoute(page, "/drill");

  await expect(main.getByRole("heading", { name: "Drilling" })).toBeVisible();
  await expectFinePointerAction(main, "Next");

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

test.describe("only-learned mode", () => {
  test.use({ hasTouch: true });

  /**
   * Turns the mode on in Drill's picker, then marks a case learned in Learn - the only path
   * that opens both the drill-pool menu and the Learn session in one run, and so the only
   * automated check that the two routes actually agree.
   */
  test("Learn writes newly learned cases into the sticky drill pool", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const main = page.locator("main");

    await gotoRoute(page, "/learn");
    await main
      .getByRole("radiogroup", { name: "Algorithm set" })
      .getByRole("radio", { name: "PLL" })
      .click();

    await main.getByRole("button", { name: "Choose cases" }).click();
    await main.getByRole("button", { name: "PLL Ua", exact: true }).click();
    await main.getByRole("button", { name: "Learned", exact: true }).click();

    // The algorithm set is one shared key, so PLL carries into Drill without reselecting it.
    await gotoRoute(page, "/drill");
    await main.getByRole("button", { name: "Choose cases" }).click();
    await main.getByRole("button", { name: /^Drill pool/ }).click();
    await page.getByRole("menuitemcheckbox", { name: /^Enable only learned/ }).click();
    await page.keyboard.press("Escape");

    await expect(
      main.getByRole("button", { name: "PLL Ua", exact: true, pressed: true }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", { name: "PLL Gd", exact: true, pressed: false }),
    ).toBeVisible();

    await scanAccessibility(page, "/drill (only-learned mode on)");

    await gotoRoute(page, "/learn");
    await main.getByRole("button", { name: "Choose cases" }).click();
    await main.getByRole("button", { name: "PLL Gd", exact: true }).click();
    await main.getByRole("button", { name: "Learned", exact: true }).click();

    await gotoRoute(page, "/drill");
    await main.getByRole("button", { name: "Choose cases" }).click();
    await expect(
      main.getByRole("button", { name: "PLL Gd", exact: true, pressed: true }),
    ).toBeVisible();

    expectNoPageErrors(pageErrors);
  });
});

test("Learn flow: guided session and case picker", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const main = page.locator("main");

  await gotoRoute(page, "/learn");

  await expect(main.getByRole("heading", { name: "Learning" })).toBeVisible();
  await expectFinePointerAction(main, "Learned");

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
