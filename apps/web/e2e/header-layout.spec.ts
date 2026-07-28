import { expect, test } from "@playwright/test";

import { stubContentApi } from "./fixtures/content-api";

/**
 * The header breadcrumb is one flex line holding the home logo and the crumb
 * trail. Wrapping belongs on the trail — the logo must stay beside it at every
 * width.
 *
 * This exists because the invariant was broken and the break was invisible to
 * every other check. Turning `Breadcrumbs` into a `nav` landmark moved
 * `flex-wrap` onto the element containing the logo, and at 640-768px — the only
 * band where the trail is long enough to need the room — the logo dropped onto
 * a row of its own and the header grew from 24px to 102px tall. Lint, types,
 * the unit suite, the axe scans and Lighthouse all stayed green, and every
 * screenshot taken at the time was desktop width.
 *
 * `/projects/:slug` carries the longest trail (three crumbs), so it is the
 * route where the trail is most likely to demand a second line.
 */
const WIDTHS = [375, 640, 768, 1024];

for (const width of WIDTHS) {
  test(`header breadcrumb keeps the logo on the trail's row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await stubContentApi(page);
    await page.goto("/projects/cube-trainer", { waitUntil: "domcontentloaded" });

    // Measuring straight after `domcontentloaded` reads the pre-hydration DOM
    // and reports a collapsed layout. Caught as a flake: without this wait the
    // 640/768/1024 cases failed on the first attempt and passed on retry, and
    // the run still reported "5 passed".
    await expect(page.getByRole("navigation", { name: "Breadcrumb", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to projects" })).toBeVisible();

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('nav[aria-label^="Breadcrumb"]')].map((nav) => {
        const logo = nav.querySelector("a[aria-label='Unimatrix-01 home']");
        const trail = nav.querySelector("span");

        if (logo === null || trail === null) {
          return null;
        }

        const logoRect = logo.getBoundingClientRect();
        const trailRect = trail.getBoundingClientRect();

        return {
          label: nav.getAttribute("aria-label"),
          // "Same row" is judged against the logo's own height rather than an
          // exact match: the logo and the first crumb are different heights and
          // are centre-aligned, so their tops differ by a couple of pixels even
          // when they are visually on one line.
          sameRow: Math.abs(logoRect.top - trailRect.top) < logoRect.height,
        };
      }),
    );

    expect(rows, `expected both header breadcrumbs to be present at ${width}px`).toHaveLength(2);
    expect(rows, `logo wrapped away from the breadcrumb trail at ${width}px`).toEqual([
      { label: "Breadcrumb", sameRow: true },
      { label: "Breadcrumb, condensed header", sameRow: true },
    ]);
  });
}
