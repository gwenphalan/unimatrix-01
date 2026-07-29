import { expect, test } from "@playwright/test";

import {
  expectCircuitFieldRespectsOccluders,
  expectNoTracesOverSelectors,
  waitForSettledCircuitField,
} from "@unimatrix/e2e-helpers";

// Skipped for the same reason as the `apps/web` mirror: the circuit field is
// off at `CIRCUIT_FIELD_ENABLED` in `packages/ui`, so `window.__circuitField`
// never appears and these would time out rather than fail on a real bug.
test.skip(true, "the circuit field is disabled — see CIRCUIT_FIELD_ENABLED");

/**
 * The `apps/web` mirror of this spec explains the invariant; this one exists
 * because cube-trainer is the app where automatic discovery has the most to get
 * wrong.
 *
 * `/learn` renders a grid of `CasePreviewCard`s, each a
 * `<button className="site-panel …">` — a painting surface that is also an
 * interactive control, so the classifier must key on paint alone and must not
 * inherit the old manual path's interactive-element exclusion. `/learn` also
 * lost two `{enabled: cases.length > 0}` registrations on `section` elements
 * that paint nothing: the section rect is now replaced by its heading's ink plus
 * one hard rect per card, and the 12px `gap-3` between cards is expected to stay
 * blocked by the 8px buffer alone.
 *
 * `/` is in the matrix because its control cluster is the thinnest cover on any
 * route: the wordmark row and the mode tiles are all a trace has to route
 * around. It used to be force-included through a padded `useCircuitOccluder`
 * wrapper — that was removed, so the row is now soft (a 36px control is under
 * the 40px `MIN_HARD_SIDE_PX` floor) and this is the route where the loss would
 * show first.
 */
// cube-trainer renders no `header` element at all, and its `AppFooter` is a bare
// `<footer className="py-1">` that paints nothing — only its text is an
// occluder, as ink. `.site-panel` is the whole painting surface vocabulary here.
const SURFACE_SELECTORS = [".site-panel", "button.site-panel"];

const ROUTES = [
  { label: "home", path: "/" },
  { label: "learn", path: "/learn" },
];

const WIDTHS = [1024, 1440];

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`circuit traces stay out of surfaces on ${route.label} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 900, width });
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await waitForSettledCircuitField(page, SURFACE_SELECTORS);

      const label = `${route.label} @ ${width}`;

      await expectCircuitFieldRespectsOccluders(page, label);
      await expectNoTracesOverSelectors(page, label, SURFACE_SELECTORS);
    });
  }
}

/**
 * The plan's manual checklist called for a scroll gesture through a case grid,
 * because `/learn` is where scrolling moves the most surfaces at once — every
 * `CasePreviewCard` is its own hard rect. Same shape as the `apps/web` scroll
 * case: only the surface invariant is asserted, since clipping the *soft*
 * remainder — a lone short line, an icon — via the routing ladder's last tier is
 * accepted behaviour. Text blocks big enough for the lattice are not soft and are
 * covered by the strict channel.
 */
test("scrolling a case grid does not leave traces inside a card", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/learn", { waitUntil: "domcontentloaded" });
  await waitForSettledCircuitField(page, SURFACE_SELECTORS);

  await page.mouse.wheel(0, 500);
  await waitForSettledCircuitField(page, SURFACE_SELECTORS);

  await expectNoTracesOverSelectors(page, "learn scrolled @ 1440", SURFACE_SELECTORS);
});

test("the field still draws traces on a wide cube-trainer home page", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForSettledCircuitField(page, SURFACE_SELECTORS);

  const sample = await expectCircuitFieldRespectsOccluders(page, "home @ 1440 density");

  expect(sample.nonEmptyPathCount, "every trace path is empty — the field is dead").toBeGreaterThan(
    0,
  );
});
