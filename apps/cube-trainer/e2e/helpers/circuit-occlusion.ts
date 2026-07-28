import { type Page, expect } from "@playwright/test";

/**
 * Measurement helpers for the circuit field's occlusion invariant.
 *
 * The field is a `position: fixed; z-index: -1` SVG, so paint occlusion is free
 * — content always paints on top. What these helpers check is *routing*
 * occlusion: that no trace is generated into a surface in the first place, so
 * nothing ever looks like it runs underneath an opaque panel.
 *
 * SYNC NOTE: this file exists **byte-for-byte** at both
 * `apps/web/e2e/helpers/circuit-occlusion.ts` and
 * `apps/cube-trainer/e2e/helpers/circuit-occlusion.ts`. Edit one, copy it to the
 * other, and check with `diff` — nothing enforces it. Naming both paths rather
 * than "the other app" is deliberate: byte-identity means whichever copy you are
 * reading says the same thing, so a note phrased as a pointer would send a reader
 * of one copy back to the file they already have open, and fixing that per copy
 * would break the `diff` check this note asks for. The per-app copy follows
 * the convention `accessibility.ts` already set (Playwright suites are per-app,
 * `packages/ui` has no browser suite and so ships no test helpers), but at 400
 * lines the copy is well past the size where that convention pays for itself.
 * Extracting both helpers into a `@unimatrix/e2e-helpers` workspace package is a
 * planned follow-up; the two `accessibility.ts` copies have already drifted,
 * which is the failure mode this note exists to delay.
 */

export type OccluderKind = "hard" | "ink" | "soft";

/**
 * `kind` rides along from the app: `inflateRect`/`translateRect` are
 * tag-preserving, so the rects the debug snapshot publishes still carry it. An
 * absent tag means `"hard"`, exactly as in `packages/ui`.
 */
export type MeasuredRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind?: OccluderKind;
};

type CircuitSample = {
  /**
   * Cell-blocking barrier rects, buffer-inflated, in viewport coordinates —
   * painting surfaces (`kind` absent or `"hard"`) *and* blocks of text
   * (`kind: "ink"`). Both are strict: nothing may be generated inside either.
   */
  hard: MeasuredRect[];
  /** Soft rects: ink too small to claim a lattice cell. Advisory, best-effort. */
  soft: MeasuredRect[];
  /** Every trace vertex plus samples along each segment, viewport coordinates. */
  pathPoints: { x: number; y: number }[];
  /** Centres of every via / tip / packet rect that has been placed. */
  placedRects: { x: number; y: number; opacity: number }[];
  pathCount: number;
  nonEmptyPathCount: number;
};

/**
 * Segments are sampled this densely (px) rather than tested exactly. Traces are
 * orthogonal on a 40px lattice and barriers are at least 40px plus an 8px
 * buffer, so a 5px stride cannot step over a barrier: any real crossing
 * produces at least ten violating samples. That redundancy is what lets the
 * soft budget below stay near zero without being tangency-sensitive.
 */
const SAMPLE_STEP_PX = 5;

/**
 * A tip / intersection / packet rect that has never been positioned still
 * carries the `x="-3" y="-3"` sentinel it was rendered with. Those are excluded
 * by *coordinate*, not by opacity: an opacity filter would make the assertion
 * depend on which animation frame the measurement landed in, and this one does
 * not.
 */
const PARKED_SENTINEL = -3;

async function sampleField(page: Page): Promise<CircuitSample> {
  const sample = await page.evaluate(
    ({ step, parked }) => {
      const svg = document.querySelector("svg[data-circuit-field]");

      if (svg === null) return null;

      const root = svg.querySelector("g");
      const match = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/u.exec(
        root?.getAttribute("transform") ?? "",
      );
      // The field generates on the unphased `n * GRID` lattice and applies the
      // grid phase as one translate on its root `<g>`, so every coordinate read
      // out of the DOM below needs that offset added to become a viewport
      // coordinate. `occluders()` is already published in viewport space.
      const offsetX = match ? Number(match[1]) : 0;
      const offsetY = match ? Number(match[2]) : 0;

      const pathPoints: { x: number; y: number }[] = [];
      let pathCount = 0;
      let nonEmptyPathCount = 0;

      for (const path of svg.querySelectorAll("path")) {
        pathCount += 1;

        const d = path.getAttribute("d") ?? "";
        const numbers = d.match(/-?\d+(?:\.\d+)?/gu);

        if (numbers === null || numbers.length < 4) continue;

        nonEmptyPathCount += 1;

        const vertices: { x: number; y: number }[] = [];

        for (let i = 0; i + 1 < numbers.length; i += 2) {
          vertices.push({
            x: Number(numbers[i]) + offsetX,
            y: Number(numbers[i + 1]) + offsetY,
          });
        }

        vertices.forEach((vertex, index) => {
          pathPoints.push(vertex);

          const next = vertices[index + 1];

          if (next === undefined) return;

          const steps = Math.floor(Math.hypot(next.x - vertex.x, next.y - vertex.y) / step);

          for (let s = 1; s < steps; s += 1) {
            pathPoints.push({
              x: vertex.x + ((next.x - vertex.x) * s) / steps,
              y: vertex.y + ((next.y - vertex.y) * s) / steps,
            });
          }
        });
      }

      const placedRects: { x: number; y: number; opacity: number }[] = [];

      for (const rect of svg.querySelectorAll("rect")) {
        const x = Number(rect.getAttribute("x"));
        const y = Number(rect.getAttribute("y"));

        if (x === parked && y === parked) continue;

        placedRects.push({
          // Rects are 6x6 rendered at `point - 3`, so this is the dot's centre.
          x: x + 3 + offsetX,
          y: y + 3 + offsetY,
          opacity: Number(getComputedStyle(rect).opacity),
        });
      }

      const api = (
        window as unknown as {
          __circuitField?: {
            occluders?: () => { hard: MeasuredRect[]; soft: MeasuredRect[] } | null;
          };
        }
      ).__circuitField;
      const occluders = api?.occluders?.() ?? null;

      return {
        hard: occluders?.hard ?? [],
        soft: occluders?.soft ?? [],
        pathPoints,
        placedRects,
        pathCount,
        nonEmptyPathCount,
      };
    },
    { step: SAMPLE_STEP_PX, parked: PARKED_SENTINEL },
  );

  expect(sample, "no svg[data-circuit-field] found — CircuitField did not mount").not.toBeNull();

  return sample as CircuitSample;
}

/**
 * The same predicate the hard assertions below use — trace geometry plus
 * *visible* dots — so the wait cannot declare the field settled on a state the
 * assertion would then reject.
 */
async function hardViolationCount(page: Page, selectors: readonly string[]): Promise<number> {
  const sample = await sampleField(page);
  const points = sample.pathPoints.filter((point) =>
    sample.hard.some((rect) => contains(rect, point)),
  );
  const dots = sample.placedRects.filter(
    (dot) => dot.opacity > 0.01 && sample.hard.some((rect) => contains(rect, dot)),
  );
  // The selector check counts too, so the wait cannot settle on a state that
  // satisfies the app's own barrier set while a trace still crosses a real
  // panel — which is precisely the shape a scanner miss would take.
  const surfaces =
    selectors.length === 0 ? [] : surfaceViolations(sample, await measureSurfaces(page, selectors));

  return points.length + dots.length + surfaces.reduce((total, entry) => total + entry.hits, 0);
}

/**
 * Waits for the field to reach its settled state: occluders committed, and the
 * rendered traces consistent with them.
 *
 * Two things this deliberately does *not* do, both learned by measurement:
 *
 * 1. No `waitForTimeout`. `header-layout.spec.ts` documents a real flake here
 *    where measuring straight after `domcontentloaded` read pre-hydration layout
 *    and still reported a pass.
 * 2. No "wait until the path `d` values stop changing". They never do — the idle
 *    packet trails are rewritten every animation frame, and a 7s timeline on
 *    cube-trainer `/` measured total trace vertices climbing 106 → 206 with no
 *    plateau. A `d`-stability wait returns on the first pause between packet
 *    hops, which is not the same instant as the field being settled.
 *
 * What is waited on instead is violation quiescence, twice in a row. Under CPU
 * contention (four Playwright workers, or `pnpm verify` running two app suites
 * at once) the first generation can land *before* the occluder scan commits, so
 * traces exist that were routed against an emptier barrier set; the next
 * regeneration replaces them. Measured on cube-trainer `/` at 1024: 41–47
 * violating vertices immediately after load, 0 two seconds later, with the
 * committed hard set byte-identical at both instants — so the traces were stale,
 * not misrouted.
 *
 * A persistent violation never goes quiet, so this poll still fails the run; it
 * only stops the load-time transient from being reported as a routing bug. The
 * transient itself is a real (brief, visual) artefact and is called out for the
 * owner rather than hidden here.
 */
export async function waitForSettledCircuitField(
  page: Page,
  selectors: readonly string[] = [],
): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const api = (
            window as unknown as {
              __circuitField?: { occluders?: () => { hard: unknown[] } | null };
            }
          ).__circuitField;

          return api?.occluders?.()?.hard.length ?? 0;
        }),
      { message: "the occluder scan never committed a hard rect", timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  let consecutiveClean = 0;
  let lastCount = -1;

  await expect
    .poll(
      async () => {
        lastCount = await hardViolationCount(page, selectors);
        consecutiveClean = lastCount === 0 ? consecutiveClean + 1 : 0;

        return consecutiveClean;
      },
      {
        intervals: [250, 250, 500, 500, 1000, 1000],
        message: "traces kept intersecting hard occluders (last count is in the poll log)",
        timeout: 20_000,
      },
    )
    .toBeGreaterThanOrEqual(2);

  expect(lastCount, "the field never stopped intersecting its own hard occluders").toBe(0);
}

function contains(rect: MeasuredRect, point: { x: number; y: number }): boolean {
  return point.x > rect.x0 && point.x < rect.x1 && point.y > rect.y0 && point.y < rect.y1;
}

/**
 * Soft-channel violations tolerated per page. Not zero on principle: the routing
 * ladder degrades to a text-blind tier rather than dropping a trace, so a trace
 * *may* legally clip a glyph when a component's free space is entirely covered in
 * text (`route-engine.ts` documents this as tier 3). This budget absorbs a
 * tangency rather than papering over a dead channel — the `textRects` check below
 * is what proves text is still being discovered.
 *
 * It applies to the soft remainder only. Text large enough for the lattice is
 * `"ink"`, which the hard assertions above hold to zero.
 *
 * A genuine crossing yields ten or more samples at `SAMPLE_STEP_PX`, so 3
 * cannot hide one.
 */
const SOFT_SAMPLE_BUDGET = 3;

/**
 * The hard invariant: no generated geometry inside a surface.
 *
 * Checked against the app's own committed barrier set, which catches a routing
 * bug but by construction cannot catch a scanner that never found a surface —
 * `expectNoTracesOverSelectors` is the non-circular half.
 */
export async function expectCircuitFieldRespectsOccluders(
  page: Page,
  label: string,
): Promise<CircuitSample> {
  const sample = await sampleField(page);

  const hardPathViolations = sample.pathPoints.filter((point) =>
    sample.hard.some((rect) => contains(rect, point)),
  );
  // Visible dots only, and this filter is load-bearing rather than defensive.
  // A tip / intersection rect keeps the coordinates it was last written to and
  // is hidden by setting `opacity: 0`, so after a regeneration drops a trace its
  // dots stay parked wherever that trace ended — measured at (952, 410), inside
  // a `.site-panel`, on three of three parallel cube-trainer runs. Nothing
  // paints there. Asserting on it would make the suite fail for stale
  // bookkeeping while the screen is correct.
  const hardRectViolations = sample.placedRects.filter(
    (dot) => dot.opacity > 0.01 && sample.hard.some((rect) => contains(rect, dot)),
  );

  expect(
    hardPathViolations.slice(0, 5),
    `${label}: trace geometry inside a hard occluder (${hardPathViolations.length} samples)`,
  ).toEqual([]);
  expect(
    hardRectViolations.slice(0, 5),
    `${label}: a via/tip sits inside a hard occluder (${hardRectViolations.length} rects)`,
  ).toEqual([]);

  // Text discovery is a first-class part of this change: every one of these
  // routes renders text, so finding none means the ink channel died silently
  // rather than that the page has nothing to avoid.
  //
  // Deliberately not `soft.length > 0`, which is what this checked while all text
  // was soft. A block of text large enough for the lattice is `"ink"` now and
  // lands in the strict channel, so a route whose text all merged into blocks
  // would legitimately report an empty soft set and fail an assertion about the
  // wrong thing.
  const textRects = [...sample.hard.filter((rect) => rect.kind === "ink"), ...sample.soft];
  expect(textRects.length, `${label}: no ink rects were discovered`).toBeGreaterThan(0);

  const softPathViolations = sample.pathPoints.filter((point) =>
    sample.soft.some((rect) => contains(rect, point)),
  );
  // Only *visible* dots count against ink. A rect left at opacity 0 where its
  // animation ended paints nothing, so it cannot visually collide with a glyph.
  const softRectViolations = sample.placedRects.filter(
    (dot) => dot.opacity > 0.01 && sample.soft.some((rect) => contains(rect, dot)),
  );

  expect(
    softPathViolations.length,
    `${label}: trace geometry crossing ink beyond the tier-3 budget`,
  ).toBeLessThanOrEqual(SOFT_SAMPLE_BUDGET);
  expect(
    softRectViolations.length,
    `${label}: visible vias sitting on ink beyond the tier-3 budget`,
  ).toBeLessThanOrEqual(SOFT_SAMPLE_BUDGET);

  return sample;
}

/**
 * The non-circular half: a fixed selector list, measured with
 * `getBoundingClientRect` and compared **raw**. Buffering these would test the
 * buffer rather than the invariant, and reading them from the app's own
 * occluder set would make a scanner miss invisible to the assertion.
 *
 * `h1`/`h2` are deliberately absent. A heading's block box spans its container
 * while its ink is only as wide as the glyphs, and routing a trace through that
 * empty tail is correct behaviour, not a violation.
 *
 * Known limitation this list encodes rather than hides: the classifier keys on
 * `background`/`backdrop-filter`/replaced tags, so a 1px `border-b` rule is not
 * a surface and a trace may cross one. Passing such an element in here would
 * fail for a real reason at the wrong level — the fix would be a border tier in
 * the classifier, not a stricter selector list.
 */
type SurfaceRect = MeasuredRect & { selector: string };

async function measureSurfaces(page: Page, selectors: readonly string[]): Promise<SurfaceRect[]> {
  return await page.evaluate(
    (list) => {
      const found: { selector: string; x0: number; y0: number; x1: number; y1: number }[] = [];

      for (const selector of list) {
        for (const el of document.querySelectorAll(selector)) {
          const visible =
            typeof el.checkVisibility === "function"
              ? el.checkVisibility({
                  contentVisibilityAuto: true,
                  opacityProperty: true,
                  visibilityProperty: true,
                })
              : true;

          if (!visible) continue;

          const box = el.getBoundingClientRect();

          if (box.width < 1 || box.height < 1) continue;
          // Off-screen surfaces are not occluders — the scanner prunes them, so
          // asserting against them would fail for the right reason at the wrong
          // place.
          if (box.bottom < 0 || box.top > window.innerHeight) continue;

          found.push({
            selector,
            x0: box.left,
            x1: box.right,
            y0: box.top,
            y1: box.bottom,
          });
        }
      }

      return found;
    },
    [...selectors],
  );
}

function surfaceViolations(
  sample: CircuitSample,
  surfaces: readonly SurfaceRect[],
): { selector: string; hits: number; rect: SurfaceRect }[] {
  return surfaces
    .map((surface) => ({
      selector: surface.selector,
      hits: sample.pathPoints.filter((point) => contains(surface, point)).length,
      rect: surface,
    }))
    .filter((entry) => entry.hits > 0);
}

export async function expectNoTracesOverSelectors(
  page: Page,
  label: string,
  selectors: readonly string[],
): Promise<void> {
  const sample = await sampleField(page);
  const surfaces = await measureSurfaces(page, selectors);

  expect(surfaces.length, `${label}: none of ${selectors.join(", ")} were present`).toBeGreaterThan(
    0,
  );
  expect(
    surfaceViolations(sample, surfaces),
    `${label}: traces run underneath a real surface`,
  ).toEqual([]);
}
