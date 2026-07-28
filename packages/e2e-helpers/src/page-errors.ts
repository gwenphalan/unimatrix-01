import { expect, type Page } from "@playwright/test";

/**
 * Uncaught page errors are invisible to Playwright's own assertions: a route can
 * satisfy every `toBeVisible` while throwing in an effect. These collect the
 * errors a page emits and assert on them explicitly, so a smoke test that passes
 * really did render without blowing up.
 *
 * `collectPageErrors` must be called before navigation — it subscribes to
 * `pageerror`, and errors thrown before the listener attaches are lost.
 */
export function collectPageErrors(page: Page): Error[] {
  const pageErrors: Error[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });

  return pageErrors;
}

export function expectNoPageErrors(pageErrors: Error[]) {
  expect(
    pageErrors.map((error) => error.message),
    "Expected the route interaction to finish without uncaught page errors.",
  ).toEqual([]);
}

/**
 * `domcontentloaded` rather than the default `load`: these are client-rendered
 * SPAs, so waiting on `load` waits on every subresource for no added signal, and
 * the assertions that follow already wait on the elements they care about.
 */
export async function gotoRoute(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}
