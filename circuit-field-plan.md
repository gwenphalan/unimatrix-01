# CircuitField Overhaul Plan

Working doc for the `feat/circuit-field-background` line of work. Read this file at the
start of every session before touching code — it is the source of truth across `/clear`
boundaries. Update the **Progress** checkboxes and **Session Log** as you go; do not trust
memory of a prior session, trust this file.

Component under change: `packages/ui/src/components/circuit-field.tsx` (1341 lines,
pre-split). Consumers: `apps/web/src/app/app-shell.tsx`, `apps/cube-trainer/src/app/app-shell.tsx`,
`apps/auth/src/app/app-shell.tsx` — three different layouts (web has header/footer/max-width
gutters, cube-trainer is a centered flex column, auth is a single centered card, no header).

## Root cause (verify before Session B/C work)

`GridGraph` (union-find over grid lattice points) in `tryAdd()` merges every trace that
touches another into one connected component. After a handful of traces the whole field is
one component, and any later trace touching existing geometry at 2+ cells is rejected. 6
attempts fail in `buildTraceFromStart`, then it falls to the 4-direction single-GRID stub or
the zero-length degenerate (line ~307). This is the "small / single-cell / disconnected
circuit lines" bug reported by the user.

**Verification task (do first, cheap):** instrument `buildTraceFromStart`'s return path —
count attempt-loop successes vs. fallback stubs vs. degenerates across ~20 regenerations at a
few viewport sizes. Confirms whether the last third of traces are dominated by fallback.

**Ordering hazard:** measuring real DOM obstruction (dynamic keep-out) increases occupied
area vs. the current fixed 14–86% / 10–78% rect. Landing dynamic keep-out before fixing
generation will starve the generator harder, not less. Phases 3 and 4 must land together.

## Hard invariants — do not regress these (prior session spent 102 messages fixing them)

- Every emitted segment axis-aligned (no diagonals).
- Every vertex an exact `GRID` (40px) multiple; `snap()` after every clamp.
- No loops — not a trace looping on itself, not two traces retracing the same stretch, not a
  cycle formed by the combined shape of several traces.
- Vias only at real bends (`recomputeCorners`), never mid-straight-run.
- Tip vias suppressed when colinear with another trace's segment at that cell
  (`isColinearWithOther`).
- Fixed per-trace slot count with stable 1:1 identity across regenerations (`traceIds`,
  `liveBodyRef[i]`, `pathElRefs` keyed by `t${i}`) — the render layer depends on this.

Add regression tests for all of these once the generation module is pure (Session A).

## Token-efficiency session grouping

Each session below is meant to fit inside one usage window. `/clear` between sessions.
Don't re-read the full monolith file after Session A splits it — only open the module you're
editing. Use file-scoped lint/test commands from `AGENTS.md` during work; run full
`pnpm check` / `pnpm verify` once before each PR. Call `advisor()` at most once per session,
skipped entirely for the mechanical ones (A). Skip `/code-review ultra` except optionally on
Session C (highest regression risk).

### Session A — File split + boot animation (mechanical, no subagents needed)
- [x] Split `circuit-field.tsx` into pure modules, verbatim moves only, no behavior change:
  - `grid-math.ts` — `mulberry32`, `hashString`, `snap`, `cellKey`, `densify`,
    `recomputeCorners`, `pathData`, `polylineLength`, `easeInOutCubic`, `pointAtIndex`
  - `grid-graph.ts` — `GridGraph`
  - `trace-generation.ts` — `buildStartPoints`, `buildTraceFromStart`, `generateTraces`,
    `cellsCoveringArea`, `shuffled`
  - `route-engine.ts` — `buildRoute`, `connectorViaElbow`, `bfsConnectorCells`,
    `countRouteCollisions`, `cellOf`, `sliceWindow`, `travelDuration`,
    `buildCellAxisMap`, `findIntersections`, `isColinearWithOther`
  - `circuit-field-hooks.ts` — `useViewportSize`, `useDebouncedSize`, `useReducedMotion`
  - `circuit-field.tsx` — component + JSX only
  - Geometry/generation modules must have zero React import (enables unit testing).
- [x] Add invariant tests on the generation module: all segments axis-aligned, all vertices
  on the lattice, no cycles in emitted geometry, no via mid-straight-run.
- [x] Revamp page-load boot animation (currently `circuit-draw`/`circuit-via-in` keyframes in
  `packages/ui/src/styles.css`) into sequential board power-on: traces light up in dependency
  order outward from a root, vias pulse once as current arrives. Order proxy for this session
  (pre-Session-C tree): sort by existing trace start-point distance from center/keep-out, or
  by current `i * 30ms` stagger already in place — good enough until Session C's real
  spanning-tree parent/child order exists to drive it properly.
- [x] Validate: `pnpm exec eslint packages/ui/src/components/circuit-field*.ts*`,
  `pnpm --filter @unimatrix/ui exec vitest run <new test files>` (check actual package name),
  visual check on all 3 apps.
- [x] Commit, PR. (PR #48, merged into `main`.)

### Session B — Per-trace transition engine (foundational, do before scroll/idle-shift)
- [x] Replace the single `useLayoutEffect` run (one shared `startTime`/`durations`/
  `windowBounds`, cancels+restarts ALL traces on any change) with a map of in-flight
  transitions keyed by trace id, one shared rAF running while any transition is live.
- [x] Preserve current behavior exactly for the route-change/resize case (regression test:
  full-field transition still looks/behaves identical) — this session is a refactor of the
  transition mechanism, not a behavior change yet.
- [x] `advisor()` once before writing, to sanity-check the transition-map design against the
  existing ref architecture (`pathElRefs`, `viaElRefs`, `tipElRefs`, `liveBodyRef`).
- [x] Validate: manual check — rapid route changes, rapid resize, verify no diagonal jumps,
  no stuck traces (regressions from the prior session's bug reports).
- [ ] Commit, PR.

### Session C — Occluder measurement + generation rewrite (heaviest, land together)
- [ ] `KeepOut` → `KeepOut[]`. Update `inKeepOut` predicates in `buildStartPoints` and
  `buildTraceFromStart`, and `cellsCoveringArea`'s area subtraction (union area, not one
  rect).
- [ ] Export `useCircuitOccluder(ref)` hook + context provider from `@unimatrix/ui/public`.
  Do NOT wrap consumers in an extra div — breaks flex/grid layouts (site-panel etc). One
  shared `ResizeObserver` across all registrants, rAF-batched, rects unioned.
- [ ] Soft-everywhere occlusion (decided): no hard keep-out rects. `KeepOut[]` becomes a
  density-weight field — registered occluder rects reduce local trace density/opacity rather
  than excluding cells outright. Traces may render behind translucent panels at reduced
  opacity. Rework `inKeepOut` predicates in `buildStartPoints`/`buildTraceFromStart` into a
  weighted acceptance probability instead of a binary reject.
- [ ] `traceCount` (currently frozen at mount via `traceCountRef`, derived from
  `size.width * size.height`) must derive from *available* area after occlusion, and react
  to resize/occlusion changes (mount/unmount path elements — line ~1084's `?? fallback`
  already anticipates length mismatch). Add a floor so a dense page reduces count instead of
  cramming slivers into remaining space.
- [ ] Replace greedy independent-trace generation (`generateTraces`) with a single rectilinear
  spanning tree: pick junction pads in available area, connect with Manhattan paths,
  Prim/Kruskal-style — each new path touches existing structure at exactly one point. Acyclic
  by construction: no rejection, no starvation, no backtracking. This structurally gives: no
  loops, minimum edge length, connectedness, real junction topology ("resembles circuit
  board"), and the adjacency map Session E's idle packets need.
- [ ] Decompose the tree into a fixed count of branch-paths deterministically so slot `i` →
  a stable comparable branch across regenerations (preserves the 1:1 identity contract from
  the invariants section).
- [ ] Re-run the Session A invariant tests against the new generator — this is exactly where
  the prior session's fixed bugs (loops, mid-straight vias, diagonals) are most likely to
  silently regress.
- [ ] `advisor()` before writing the spanning-tree algorithm, and again after a working draft.
  Optionally run `/code-review ultra` on this PR given regression risk.
- [ ] Validate on all 3 apps, desktop + mobile widths (different layouts stress occlusion
  differently — web has header/footer/gutters, cube-trainer is a centered column, auth is a
  single card with no header).
- [ ] Commit, PR.

### Session D — Scroll / content reactivity
- [ ] NOT "regenerate on scroll" — SVG is `position: fixed`, viewport coords. Mechanism:
  recompute occluder rects on scroll (rAF-throttled), diff vs. last, retarget only traces
  whose body now intersects an occluder (via Session B's per-trace transition engine).
- [ ] Fix mobile URL-bar bug: `useViewportSize` reads `window.innerHeight`, which changes as
  the mobile URL bar collapses/expands during scroll — with `RESIZE_SETTLE_MS = 200` this
  fires a full retarget mid-scroll on every phone scroll. Use `window.visualViewport` or
  ignore height-only deltas under a threshold.
- [ ] Validate: scroll test on all 3 apps on a real mobile viewport (devtools device
  emulation or Chrome extension), verify no full re-seed mid-scroll, no jank.
- [ ] Commit, PR.

### Session E — Idle packets + idle line-shift + capability gating
- [ ] Idle "bits of information": build a cell→neighbor adjacency map once per settle (not
  per-frame — current `buildCellAxisMap` + `findIntersections` already run every tick and are
  already the hottest thing in the loop; revisit that cost here too). Walk the graph, animate
  packets via a pooled fixed set of elements (same direct-ref pooling pattern as
  `intersectionElRefs`), cap the pool, split visually at junctions.
- [ ] Idle line-shift: periodically retarget a few trace ids (not all) using Session B's
  per-trace transition engine — reuse the existing crawl mechanism, do not build a second one.
- [ ] Capability gating (measure, don't sniff): `prefers-reduced-motion` (already present),
  `(pointer: coarse)`, `(update: slow)`, `prefers-reduced-data`, `navigator.hardwareConcurrency`.
  Skip `navigator.deviceMemory` alone — Chromium-only, non-standard. Add a frame-budget
  watchdog during boot: downgrade to static/motionless if the first N frames blow budget;
  downgrade must be one-way (never oscillate back to animated).
- [ ] Idle packets require a permanently-running rAF (currently rAF only runs during
  transitions) — this is a direct perf cliff. Must gate behind the capability check above,
  and stop the loop on `document.hidden` / `visibilitychange`.
- [ ] Mobile/low-power appearance (decided): static traces (freeze one generated frame, no
  rAF at all) + CSS-only stroke glow pulse (keyframe, not JS-driven) so it doesn't read as
  fully dead. No separate trace-count reduction beyond whatever the normal density/occlusion
  logic already yields at that viewport size.
- [ ] Validate: low-end device emulation (CPU throttling in devtools), background-tab check
  (rAF actually stops), all 3 apps.
- [ ] Commit, PR.

## Decisions (confirmed with user)

- **Boot animation (Session A):** sequential board power-on — traces light up in dependency
  order (spanning-tree root outward, so this depends on Session C's tree structure being in
  place conceptually; Session A can stage toward it using current trace order/length as a
  proxy, then Session C's real tree parent/child order supersedes it), vias pulse once as
  current arrives at them.
- **Occlusion rule (Session C):** soft everywhere — no hard-keep-out rects for any surface.
  Trace density falls off near any registered occluder; traces may still pass behind
  translucent panels at reduced opacity rather than being hard-excluded. Simplifies
  `KeepOut[]` to a density-weight field rather than binary in/out predicates — revisit
  `inKeepOut` naming/shape in `buildStartPoints`/`buildTraceFromStart` accordingly.
- **Mobile/low-power fallback (Session E):** static traces (one frozen frame, no rAF) +
  CSS-only glow pulse on the stroke (keyframe, not JS-driven) so it doesn't read as fully
  dead. No trace-count reduction beyond what the normal density/occlusion logic already gives
  on a smaller viewport.

## Session Log

Fill in briefly at the end of each session — what landed, what got deferred, what surprised
you. Keep entries short; this file is a resume point, not a changelog.

- Session A: Done. Split into `grid-math.ts`, `grid-graph.ts`, `trace-generation.ts`,
  `route-engine.ts` (verbatim moves, zero React import — the pure geometry/generation
  modules), `circuit-field-hooks.ts` (verbatim move, does import React — it holds the
  hooks), `circuit-field.tsx` down to component+JSX. Added `test/trace-generation.test.ts` (20 cases
  across 4 viewport/seed/count scenarios) covering all four Hard Invariants against
  `generateTraces`' real output — all pass. Boot animation: `targetTraces` memo now returns
  `{ traces, keepOut }`; per-trace boot delay is keep-out-center distance (normalized 0–500ms,
  replacing `i * 30`), per-via delay is `traceDelay + (idx / (body.length-1)) * 650ms`
  (650 = `circuit-draw`'s CSS duration, kept as a manually-synced `TRACE_DRAW_MS` constant with
  a comment — CSS can't be read back from JS) so vias visibly trail the stroke draw-in instead
  of popping together. Lint/typecheck/full `vitest run` clean; visually verified on all 3 apps
  (web, cube-trainer, auth) via a real browser — traces render identically to pre-split,
  console clean apart from an unrelated Clerk dev-key notice. Reduced-motion path untouched by
  design (verified by inspection, not live-toggled in-browser). Committed and PR'd — PR #48,
  merged into `main`.
- Session B: Done (not yet committed). Replaced the single shared `tick()`
  (`rafRef`/`startTime`/`durations[]`/`windowBounds[]`, all indexed by array position) with
  `transitionsRef` (`Map<traceId, TraceTransition>`) and a stable `runTick` callback driven by
  one `rafActiveRef` handle. Starting/replacing a trace's transition now just
  `transitionsRef.current.set(id, ...)` — never cancels the shared loop, which is only
  `requestAnimationFrame`'d if not already running. `ViaItem.traceIndex` became
  `ViaItem.traceId` since lookups now go through the map instead of a parallel array. Each
  frame `runTick` walks `traceIds` (not just in-flight ones) to keep the cross-trace
  `cellAxisMap`/tip/intersection passes covering every trace, not just transitioning ones —
  advisor flagged that dropping settled traces from those passes would regress tip suppression
  and via visibility the instant a trace finishes early (since per-trace durations already
  differ, traces finish at different frames). A finished trace is deleted from the map and its
  settled via items are folded into `viaItems` immediately (filtering that trace's old entries
  out of `viaItemIndexRef` and pushing the new ones), independent of any siblings still
  crawling; the per-frame opacity pass explicitly skips (does not hide) vias whose trace isn't
  in `windowBounds` that frame, so a fast-finishing trace's vias don't flicker off while slower
  ones keep animating. Reduced-motion snap path now explicitly clears `transitionsRef` and
  cancels any active `rafActiveRef` before writing final state synchronously, so a mid-crawl
  toggle to `prefers-reduced-motion` can't leave a stale frame to clobber it. `advisor()` called
  once before writing per the session budget; its per-trace-finish opacity/tip-suppression
  finding is the main thing the naive "just delete from the map" version would have missed.
  Lint/typecheck/existing `vitest run` clean (no behavior in scope to add new automated tests
  for — this is the JS-driven crawl mechanism, exercised by manual browser checks per the
  session's validate step). Visually verified on all 3 apps via rapid route-change clicks
  (web nav, cube-trainer Learn/Drill, auth sign-in/sign-up) — no diagonal jumps, no stuck
  traces, no via flicker on early-finishing traces, console clean on all three. Not yet
  committed/PR'd.
- Session C: _not started_
- Session D: _not started_
- Session E: _not started_
