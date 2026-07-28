import { expect, test } from "@playwright/test";

import {
  expectCircuitFieldRespectsOccluders,
  expectNoTracesOverSelectors,
  waitForSettledCircuitField,
} from "./helpers/circuit-occlusion";

/**
 * The circuit field discovers its own occluders by walking the DOM and
 * classifying what paints, rather than by hand-registered
 * `useCircuitOccluder(ref)` calls. A forgotten registration used to fail
 * silently — a trace ran under a panel and nothing caught it — and the whole
 * point of automatic discovery is that the same failure mode is now a bug in one
 * classifier instead of an omission in sixteen files. So it needs a check that
 * fails loudly.
 *
 * Two widths, chosen for what they mean rather than for coverage: 1440 is the
 * design target, and 1024 is where `PublicPageContainer`'s gutters collapse to
 * ~32px on article routes and the field legitimately runs out of negative space.
 */
/**
 * Painting chrome only. A bare `header` is deliberately *not* in this list:
 * article routes open with `<header className="space-y-5 border-b …">` — a
 * transparent title block whose only paint is its own text plus a 1px rule.
 * Its ink is what the field must avoid, and routing a trace through the empty
 * space beside a two-line title is correct. Asserting on the block box instead
 * would demand the field treat a container as opaque because of the tag it
 * happens to use.
 */
const SURFACE_SELECTORS = [
  "header.site-panel",
  "footer.site-panel",
  ".site-panel",
  "button.site-panel",
];

const ROUTES = [
  { label: "home", path: "/" },
  { label: "projects", path: "/projects" },
  { label: "about", path: "/about" },
  { label: "blog post", path: "/blog/placeholder-post" },
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
 * Scrolling is the one path that re-measures occluders without a full style
 * walk, and it moves every surface at once. Worth its own case because the
 * scroll path is documented best-effort: `retargetTip` nudges tips out of the
 * cell-blocking channel (surfaces *and* text blocks), and the `SCROLL_SETTLE_MS`
 * structural commit is the backstop that regenerates against the new geometry.
 *
 * Only the surface invariant is asserted after scrolling. A block of text is a
 * cell-blocking barrier now, so `expectCircuitFieldRespectsOccluders` already
 * covers it through the strict channel; what stays best-effort is the *soft*
 * remainder — single short lines and icons, which the routing ladder's last tier
 * may clip. Pinning a sample count for those would encode a value nobody chose.
 *
 * Measured by hand on `/projects/cube-trainer` at 1908x879, because the
 * intermediate state is what a real user sees: immediately after the wheel
 * stops, 250 trace samples sat inside surfaces and 103 inside soft rects; both
 * were 0 once the settle commit landed. `waitForSettledCircuitField` below is
 * what makes this assertion measure the converged state rather than that one.
 */
test("scrolling does not leave traces inside a surface", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/projects/cube-trainer", { waitUntil: "domcontentloaded" });
  await waitForSettledCircuitField(page, SURFACE_SELECTORS);

  await page.mouse.wheel(0, 400);
  // Re-settling after the scroll is the assertion: `waitForSettledCircuitField`
  // fails if the field never becomes consistent with its moved occluders.
  await waitForSettledCircuitField(page, SURFACE_SELECTORS);

  await expectNoTracesOverSelectors(page, "project page scrolled @ 1440", SURFACE_SELECTORS);
});

/**
 * Density, both directions. The occlusion assertions above are satisfied
 * trivially by a field that draws nothing, and the article-route trade-off is
 * that the field really can be empty — so each side of that gets stated
 * explicitly rather than left to whichever assertion happens to notice.
 */
test("the field is not occluded out of existence on a wide home page", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForSettledCircuitField(page, SURFACE_SELECTORS);

  const sample = await expectCircuitFieldRespectsOccluders(page, "home @ 1440 density");

  expect(sample.nonEmptyPathCount, "every trace path is empty — the field is dead").toBeGreaterThan(
    0,
  );
});

test("an article route at 1024px is allowed to have no room for traces", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1024 });
  await page.goto("/blog/placeholder-post", { waitUntil: "domcontentloaded" });
  await waitForSettledCircuitField(page, SURFACE_SELECTORS);

  // Deliberately asserts nothing about density. The article panel is `max-w-4xl`
  // (896px) inside a `max-w-[92rem]` container, so at 1024px the gutters are
  // ~32px per side — narrower than one 40px lattice cell plus its buffer. An
  // empty field here is the chosen outcome of making article panels fully
  // occluding, not a regression, and this test exists to say so where someone
  // debugging "the field vanished" will find it.
  const sample = await expectCircuitFieldRespectsOccluders(page, "blog post @ 1024 density");

  expect(sample.pathCount, "the field did not render its trace slots at all").toBeGreaterThan(0);
});
