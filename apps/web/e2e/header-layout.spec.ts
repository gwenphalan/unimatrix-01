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
      [...document.querySelectorAll('nav[aria-label^="Breadcrumb"]')]
        // The condensed overlay is `hidden` below `sm`, where its two-row nav
        // would cover an eighth of a phone screen. A hidden element measures
        // 0×0, so it is dropped here rather than being read as a wrapped logo.
        .filter((nav) => nav.getBoundingClientRect().height > 0)
        .map((nav) => {
          const logo = nav.querySelector("a[aria-label='Unimatrix-01 home']");
          const trail = nav.querySelector("span");

          if (logo === null || trail === null) {
            return null;
          }

          const logoRect = logo.getBoundingClientRect();
          const trailRect = trail.getBoundingClientRect();

          // Crumb segments hidden below `sm` measure 0×0, so they are dropped
          // rather than counted as a row of their own.
          const crumbs = [...trail.children].filter(
            (crumb) => crumb.getBoundingClientRect().height > 0,
          );

          return {
            label: nav.getAttribute("aria-label"),
            // "Same row" is judged against the logo's own height rather than an
            // exact match: the logo and the first crumb are different heights
            // and are centre-aligned, so their tops differ by a couple of
            // pixels even when they are visually on one line.
            sameRow: Math.abs(logoRect.top - trailRect.top) < logoRect.height,
            // The trail itself must not break either. Keeping the logo on the
            // trail's row is only half the invariant: with the trail free to
            // wrap, "Unimatrix-01" and "> Home" stack beside a `shrink-0` logo
            // and the header reads as squashed rather than as one line.
            trailRows: new Set(crumbs.map((crumb) => Math.round(crumb.getBoundingClientRect().top)))
              .size,
          };
        }),
    );

    const expected = [{ label: "Breadcrumb", sameRow: true, trailRows: 1 }];

    if (width >= 640) {
      expected.push({ label: "Breadcrumb, condensed header", sameRow: true, trailRows: 1 });
    }

    expect(rows, `unexpected set of visible header breadcrumbs at ${width}px`).toEqual(expected);
  });
}
