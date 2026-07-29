import { expect, test } from "@playwright/test";

/**
 * `GraphBackground` writes the four variables `.grid-backdrop` reads to keep its
 * lattice centered. Nothing else writes them, and getting them wrong is not a
 * thrown error — the grid just sits visibly off-center, which is a class of bug
 * only a rendered page catches. The unit suite pins the arithmetic against a
 * stubbed observer; this pins that a real browser's `ResizeObserver` on
 * `documentElement` actually delivers, which no jsdom test can.
 */
const readPhase = () => ({
  clientWidth: document.documentElement.clientWidth,
  clientHeight: document.documentElement.clientHeight,
  px: Number.parseFloat(document.documentElement.style.getPropertyValue("--grid-phase-x")),
  py: Number.parseFloat(document.documentElement.style.getPropertyValue("--grid-phase-y")),
  bx: Number.parseFloat(document.documentElement.style.getPropertyValue("--grid-bold-phase-x")),
});

test("grid phase recomputes on viewport resize", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--grid-phase-x") !== "",
  );

  const before = await page.evaluate(readPhase);

  // 1294 is deliberately not a multiple of 80, so the correct phase is a value
  // the initial measurement could not already have produced.
  await page.setViewportSize({ width: 1294, height: 902 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(readPhase);

  expect(after.clientWidth).toBe(1294);
  expect(after.px, "phase must change when the viewport does").not.toBe(before.px);
  expect((after.clientWidth / 2 - after.px) % 40, "fine line lands on the centerline").toBe(0);
  expect((after.clientHeight / 2 - after.py) % 40, "fine line lands on the centerline").toBe(0);
  expect(
    (((after.clientWidth / 2 - after.bx) % 240) + 240) % 240,
    "centerline sits mid bold cell",
  ).toBe(120);
});
