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

## Known issues (reported 2026-07-25, not yet triaged)

User-reported, observed live on the production deploy of `main` (`unimatrix-01.dev` and
subdomains) — **not** reproduced or investigated yet, and **not** caused by the Session E1 work
above (E1 was implemented on a branch cut from `origin/main` after these were already present;
confirmed with the user this doesn't block E1). Four symptoms, likely overlapping with the Hard
Invariants above and with prior unresolved flags in this doc:

- Circuit lines disappearing during page changes.
- Circuit lines appearing during page changes — new lines being created rather than the existing
  set moving/retargeting. Reported preference: page-change reactivity should always reuse the same
  fixed set of lines (per-trace slot identity, moved/retargeted in place), not add/remove slots.
  This may be the reactive-`traceCount` slot re-seed behavior documented as intentional in Session
  C ("A count change is a full re-seed of the affected slots") reacting more visibly now that D.5
  broadened occlusion to many per-card registrants (occluded area — and so `traceCount` — can
  differ more between routes than it did with 2-3 broad containers) — needs verification, not
  assumed.
- Circuit loops — a direct Hard Invariant violation if confirmed on settled (non-crawling) geometry.
- Vias appearing mid-straight-line — **an exact repeat of a report Session C already flagged as
  unconfirmed** ("did not reproduce in a settled, undisturbed DOM check... Flagging as unconfirmed
  rather than closed — if it recurs on a fully idle page, worth a closer look with
  `prefers-reduced-motion` forced on"). This is that recurrence.

Next session on this should investigate on `main` directly (not a Session E branch), starting from
forcing `prefers-reduced-motion` per Session C's own suggestion to rule out crawl-interpolation
sampling artifacts, and checking whether `traceCount`'s hysteresis band is actually holding across
D.5's per-card registration set before assuming the appear/disappear complaint is intentional
behavior working as designed rather than a regression.

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
- [x] Commit, PR. (PR #49, merged into `main`.)

### Session C — Occluder measurement + generation rewrite (heaviest, land together)
- [x] `occlusion.ts` (new, pure): `Rect`/`Occluder` types, `occlusionWeightAt` (soft falloff,
  `min()` combine across overlapping occluders, never a hard 0 — floor at `OCCLUDER_MIN_WEIGHT`),
  `estimateEffectiveArea` (fine sampling grid independent of the trace-count-driven coarse
  tiling, so a small occluder like a header isn't invisible to the estimate).
- [x] `trace-generation.ts` rewritten: replaced greedy independent-trace generation
  (`buildTraceFromStart`'s rejection loop against `GridGraph`) with a single rectilinear
  spanning tree grown as exactly `count` branches directly — each branch *is* one tree edge
  from birth, rather than building one tree and decomposing it after the fact (that two-phase
  approach can't hit an arbitrary branch count exactly, and a naive cut can retrace an edge,
  violating the no-loops invariant). Branch 0 walks unconstrained (self-collision-avoiding);
  every later branch finds the nearest already-placed lattice point and routes to a
  soft-occlusion-weighted target pad by reusing `route-engine.ts`'s own elbow/BFS-corridor
  machinery — acyclic by construction, so `GridGraph`/rejection is no longer used in
  production, only as a test tool. `generateTraces` now returns `{ traces, adjacency }`
  (`CircuitTree`); each `Trace` carries a `depth` (tree depth from the root) for boot ordering.
- [x] `circuit-occluder.tsx` (new): `CircuitOccluderProvider` (context, no DOM element of its
  own) + `useCircuitOccluder(ref)`, one shared rAF-batched `ResizeObserver` across every
  registrant. Takes an existing ref rather than owning one. No-ops with a `console.warn`
  outside a Provider rather than throwing.
- [x] `circuit-field.tsx`: `traceCount` is now reactive state derived from
  `estimateEffectiveArea`, with a hysteresis band to avoid thrash from small occluder jitter.
  A count change is a full re-seed of the affected slots (new slots boot in; removed slots are
  pruned from every id-keyed ref/map) rather than trying to crawl a slot whose identity just
  changed. `liveBodyRef` converted from a positional array to a `Map<id, body>` for this.
  Boot delay now comes from `trace.depth * DEPTH_STAGGER_MS` instead of the old
  distance-from-keep-out-center proxy. A trace whose generated points are unchanged since the
  last generation is skipped entirely (no transition, no DOM write) — bounds visible churn once
  occlusion-driven regeneration is frequent/small. Occluder rects feed weighting only, never
  the `hashString(routeKey:WxH)` seed.
- [x] Migrated `test/trace-generation.test.ts` to the new signature/return shape (kept all 4
  original invariant assertions, which hold regardless of construction algorithm), added:
  single-connected-component check (new `GridGraph.componentCount()`/`sameComponent()`
  test-support methods), a direct spanning-tree structural assertion (edges == vertices − 1,
  a guarantee the old generator could never make), depth/adjacency sanity checks, and a
  regression scenario (near-total occlusion still yields `count` traces with zero degenerate
  stubs — the bug this session set out to fix). New `test/circuit-occluder.test.tsx` (manual
  `ResizeObserver` mock) — **correction (Session D):** this bullet as originally written also
  claimed a new `test/occlusion.test.ts`; no such file was ever created, `occlusion.ts` had no
  dedicated test file until Session D added direct coverage via `test/scroll-retarget.test.ts`
  (which exercises `occlusionWeightAt` as part of testing `retargetTip`). Flagging here since
  this doc is the cross-session source of truth and the original claim cost a future session
  time verifying it.
- [x] Shell wiring, deliberately bounded to existing container refs (no new wrapper divs, no
  chasing every route's `Card`): web registers its existing `headerRef` plus a new `mainRef` on
  `<main id="main-content">`; cube-trainer registers a new `mainRef` on its own `<main>`; auth
  registers **zero occluders** (confirmed decision — only 2 of 5 routes have an accessible
  `Card` ref, registering just those would make density visibly differ navigating between
  near-identical-looking routes). Confirmed `--card` is opaque (no alpha) in
  `packages/ui/src/styles.css`, so auth/cube-trainer get density reduction only, not visible
  dimming through panels — only web's translucent `.site-panel` header gets the "traces show
  through, dimmed" effect, for free via existing CSS stacking (no new rendering code). PR #50
  (post-review) added a fourth registration: web's fixed condensed sticky header, gated
  `enabled: isCondensed` so it only occludes while actually visible.
- [x] `advisor()` called before writing the spanning-tree algorithm (during the planning
  session, before this implementation session started) with the design already reviewed;
  implementation followed the reviewed design directly.
- [x] Validate on all 3 apps, desktop + mobile widths, in a real browser (automated
  lint/typecheck/vitest all green across `packages/ui` and all 3 app-shells as of this commit;
  manual visual check done — see Session Log for the two bugs it caught).
- [x] Commit, PR. — PR #50 (`feat/circuit-field-occlusion-generation`).

### Session D — Scroll / content reactivity
- Not started as its own session. PR #50 (Session C's PR, responding to review feedback) landed
  one small piece — web's condensed sticky header is now registered via `useCircuitOccluder`
  while visible (`enabled: isCondensed`), so it soft-occludes correctly once it appears —  but
  deliberately did **not** add scroll-driven rect recomputation. An earlier version of that PR
  tried a `useCircuitOccluderRecompute()` hook called on every scroll event; reverted before
  merge because nothing downstream consumes a scroll-fresh rect yet — `targetTraces` regenerating
  every scroll frame would burn CPU (`generateTraces`, a spanning-tree build) for zero visible
  benefit without the diff/retarget mechanism below, and `estimateEffectiveArea`'s sampling pass
  would run every animation frame for the same reason. Real scroll reactivity needs this
  session's actual design — diff against last-measured rects, retarget only traces whose body
  now intersects a *changed* occluder — not a bare "recompute on every scroll tick."
- [x] Occluder granularity fix (discovered necessary during planning, not in the original
  checklist above — see Session Log): `mainRef` on a window-scrolling `<main>` has a real height
  equal to full page content, which for most pages exceeds one viewport — even freshly
  re-measured every scroll frame, an uncapped registration blankets the entire viewport for most
  of the scroll range (`occlusionWeightAt`'s min-combine floors at the same weight anywhere
  "inside" a rect regardless of depth), leaving nothing for a retarget mechanism to react to.
  Added `maxHeightPx` to `useCircuitOccluder`'s options (`packages/ui/src/components/
  circuit-occluder.tsx`); web's `mainRef` registers with `MAIN_OCCLUDER_MAX_HEIGHT_PX` (900px).
- [x] NOT "regenerate on scroll" — SVG is `position: fixed`, viewport coords. Mechanism:
  recompute occluder rects on scroll (rAF-throttled), diff vs. last, retarget only traces
  whose body now intersects an occluder (via Session B's per-trace transition engine).
  `CircuitOccluderProvider` now measures on both `ResizeObserver` (structural — commits
  `useCircuitOccluderRects()`, unchanged cost) and `scroll` (never commits that — only notifies
  a separate `useCircuitOccluderDelta` subscription with whatever rects moved beyond one GRID
  cell). New `scroll-retarget.ts` (pure): `findAffectedTraceIds` (tip-in-dirty-rect test),
  `retargetTip` (in-line nudge along the tip's own final-segment axis only — see Session Log for
  why a perpendicular/elbow nudge was rejected), `buildOccupiedFootprint`.
- [x] Fix mobile URL-bar bug: root cause was in `useDebouncedSize`, not `useViewportSize` —
  extended with an optional `heightJitterIgnorePx` (`HEIGHT_JITTER_IGNORE_PX = 120`) that ignores
  a width-unchanged height delta under that threshold entirely, compared against the most
  recently *accepted* target (not the stale committed value) so a jitter sample mid-flight can't
  cancel a real pending resize. Kept the threshold approach over switching to
  `window.visualViewport` — cross-browser URL-bar-collapse semantics aren't reliably confirmable
  without live devices.
- [x] Validate: scroll test on web (dev server, real browser via the Chrome extension) —
  partially confirmed, with a known gap documented in the Session Log: DOM-level wiring (scroll
  listener attaches and fires, `ResizeObserver`/register/unregister all correct, zero console
  errors, visually clean rendering — no diagonal seams, no jank — while scrolling a page forced
  taller than viewport) confirmed live; the actual rAF-gated commit/retarget step could not be
  observed firing in this automation session because the controlled tab never reports
  `document.visibilityState !== "hidden"` even when focused, which permanently starves
  `requestAnimationFrame` in that tab — a harness limitation, not exercised as a real bug (the
  same rAF-gated diff/notify path already has direct, passing coverage under jsdom in
  `test/circuit-occluder.test.tsx`, where rAF isn't visibility-gated). cube-trainer/auth not
  re-checked this session (unaffected by Session D's code paths per the granularity-fix
  reasoning above — cube-trainer's `mainRef` stays uncapped/unchanged, auth registers nothing).
  **Recommend a real mobile-device or non-automated-browser check before merging**, since that's
  the only way to actually observe the rAF-gated retarget fire.
- [x] Commit, PR.

### Design intent clarification (user, post-Session-D — read before Session D.5)

Session D's plan-mode agent (and the exploration that fed it) undersold the actual goal. Stated
plainly, for future sessions: **circuits should read as routed through the negative space around
real rectangular obstructions on the page** — not just avoiding two or three broad app-shell
containers. "Obstruction" means any visually distinct rectangular UI block: cards, panels,
sections, footer, nav — the actual content shapes a user sees, not a coarse header/main split.
The scroll and page-change *mechanics* built in Session D are correct and are staying as-is:
- Nudge, don't retrace, on scroll: a trace whose tip sits near an obstruction that just moved
  gently repositions/reforms — it does not rebuild from scratch.
- Full reform on page/route change: already existing behavior (`routeKey`-keyed regeneration in
  `targetTraces`), unaffected by any of this.

What needs to change in a follow-up session is **what counts as a registered obstruction** — see
Session D.5 below. This also explicitly **supersedes** Session C's "auth registers zero
occluders" / "only 2 of 5 routes have an accessible Card ref, registering just those would make
density visibly differ" reasoning (see Decisions below) — that was a deliberate minimalism call
at the time, made without this broader negative-space goal in view.

### Session D.5 — Broaden occlusion to real rectangular content blocks (negative-space routing)

Done (implementation + automated checks). See Session Log entry below for what shipped, the two
blocking findings a planning pass caught before writing code, and the live-browser visual gap.

- [x] Identify the actual candidate registration points per app: web's project/blog cards on
  the home/list routes, content cards on detail routes, the footer; auth's sign-in/sign-up
  wrapper `div`s around the Clerk widgets; cube-trainer's drill/learn panels. Prefer registering
  existing layout wrapper elements
  already present in each route's JSX (reuse refs the component tree can cheaply expose) over
  inventing new wrapper divs — same constraint Session C already followed for header/main.
- [x] Revisit auth specifically: Session C's call to register zero occluders there because "only
  2 of 5 routes have an accessible Card ref" is the thing being overridden — either get a ref on
  the Card in the other 3 routes too, or accept a partial rollout there if some routes genuinely
  have no single wrappable rectangle, and say so explicitly rather than silently reverting to
  zero coverage.
- [x] Decide whether `useCircuitOccluder` needs to support many more simultaneous registrants
  cheaply (it already batches via one shared `ResizeObserver` + rAF, so this is likely fine, but
  confirm cost doesn't scale badly once a route has, say, 10+ registered cards instead of 2-3
  containers).
- [x] `maxHeightPx` (Session D) may no longer be the primary tool once occluders are
  individually-sized real content blocks instead of one tall scrolling container — a card is
  already bounded to its own real height. Revisit whether the cap is still needed for anything
  (e.g. a long single-column list wrapper) once per-card registration exists.
- [x] Validate visually: on a card-dense route (e.g. the projects/blog list), confirm circuits
  visibly route through the gaps between cards rather than just avoiding one big content block.
  Confirmed live via the Chrome extension on web (`/`, `/projects`, `/about`, a project detail
  route), cube-trainer (`/`, `/learn`), and auth (`/`, `/sign-in`) — no console errors on any
  route. Caught and fixed one real bug live (see Session Log): the spanning tree's root always
  seeded from the canvas's geometric-center cell regardless of occlusion, so it visibly sat under
  whatever card/panel happened to be centered on the page.
- [x] Commit, PR.

### Session E — split into E1 (motion modes + loop lifecycle) and E2 (idle behaviors)

Planned via a Planner-agent (opus) pass, reviewed by `advisor()` before writing code — see Session
Log for what the advisor pass caught. Split because the original single checklist spans two new
pure modules, a new hook, a rewrite of the rAF lifecycle, a new pooled DOM layer, and a new CSS
mode — too large for one usage window per this doc's own grouping goal. **E1 must land and merge
(its own branch/PR, cut fresh from `origin/main` after E1 merges) before E2 starts** — E2's
permanently-running idle rAF is only affordable because of E1's loop gate, and is gated behind
E1's mode enum. This branch (`feat/circuit-field-idle-capability`) covers **E1 only**.

#### Session E1 — Capability gating, motion modes, loop lifecycle

Covers original bullets 3, 4 (the loop half), 5.

- [x] `capability.ts` (new, pure, zero React) — `MotionMode = "full" | "transitions-only" |
  "static"`, `CapabilitySignals`, `readCapabilitySignals()`, `decideMotionMode(signals)`,
  `mostRestrictive(a, b)`. `transitions-only` is exactly today's behavior (crawl on change only).
  `full` adds the permanently-running idle rAF (E2). `static` snaps everything, never schedules a
  frame. Decision order, first match wins: `prefers-reduced-motion: reduce` → static;
  `(update: slow)` → static; `prefers-reduced-data: reduce` → static; `(pointer: coarse)` →
  static (the confirmed mobile/low-power fallback below — deliberately `pointer` not
  `any-pointer`, so a touchscreen laptop with a trackpad, whose *primary* pointer is fine, is
  unaffected); `hardwareConcurrency <= 2` → static; `<= 4` → transitions-only; `undefined` →
  neutral, falls through (Safari doesn't expose it; absence must never demote on its own); else
  → full. `navigator.deviceMemory` deliberately not read — Chromium-only, non-standard.
- [x] `useMotionMode()` in `circuit-field-hooks.ts` — lazy synchronous initial state
  (`useState(() => decideMotionMode(readCapabilitySignals()))`, not an effect-based pattern like
  `useReducedMotion`'s — these are SPAs with no SSR, and an effect would mount a phone in `full`
  for one frame before demoting). `change` listeners on all four media queries. One-way rule:
  internal `preferenceMode` (recomputed live, free to move both ways) + `runtimeFloorRef` (starts
  `full`, only ratchets down via `demoteToStatic()`); exposed `mode = mostRestrictive(preferenceMode,
  runtimeFloor)`. Compose the existing `useReducedMotion`, don't duplicate its `change` handling.
- [x] `staticModeRef` generalization (highest-leverage, lowest-risk item): replace
  `reducedMotionRef` with `staticModeRef` (`mode === "static"`) at all existing read sites in
  `circuit-field.tsx` (boot via-item flag, boot dasharray branch, crawl snap branch, retarget snap
  branch, the ref-sync effect). Static mode inherits the whole already-tested snap path for free.
  **`static` ≠ "generate once"**: `routeKey` change / settled resize / occlusion commit still
  regenerate and snap (Sessions C/D reactivity fully preserved) — only per-frame interpolation is
  removed, not reactivity.
- [x] Single-loop unification, scoped to what E1 actually needs: `documentHiddenRef` +
  `loopShouldRun() = !documentHiddenRef.current && transitionsRef.current.size > 0` +
  `ensureLoop()`. Replace all existing `if (rafActiveRef.current === null) rafActiveRef.current =
  requestAnimationFrame(runTick)` call sites (crawl effect, retarget handler, `runTick`'s own
  tail) with `ensureLoop()` — centralizes the documentHidden guard E1's visibilitychange bullet
  needs across all three, without adding an `idleEnabledRef` E1 has no producer for yet.
  **`idleEnabledRef` and the `hasTransitions` gate are deferred to E2, not implemented here**
  (corrected from the planner's original pass, which had the watchdog feeding samples through
  `runTick` — since the watchdog below is a standalone probe loop instead, nothing in E1 ever
  runs the shared loop while `transitionsRef` is empty, so gating dead code this session would be
  premature; E2 adds both together when its idle producer actually needs them, same "land
  together" reasoning, just one session later than the original pass assumed).
- [x] `visibilitychange` wiring: one effect attaching to `document` on mount, detaching on
  unmount alongside the existing rAF cancel. On hide: `documentHiddenRef.current = true`, record
  `hiddenAtRef`, cancel the rAF, null the handle; in-flight transitions stay in the map untouched.
  On show: **rebase every in-flight transition's `startTime` by the hidden duration** before
  resuming — without this, wall-clock elapsed while hidden makes `t >= 1` on the first frame back
  and every in-flight trace teleports. This is a **latent bug today** (browsers already starve
  rAF in hidden tabs; a route change followed by a tab switch already produces the jump on
  return), not new-code hygiene.
- [x] `frame-budget.ts` (new, pure, zero React): `FrameBudgetVerdict = "pending" | "ok" |
  "over"`, `createFrameBudgetProbe({ samples = 40, warmupSamples = 3 }).record(timestampMs)`.
  Verdict needs both arms: `baseline = min(deltas)` (so a real 30Hz panel isn't punished), `over`
  if `dropped/samples > 0.4` where `dropped = count(delta > 1.75 * baseline)`, **or** `over` if
  `baseline > 40` (a device whose *best* frame is under 25fps has zero "dropped" frames by the
  relative test but is uniformly slow). A ratio, not one bad frame, so a single GC pause can't
  permanently demote. **Corrected post-review:** a delta past `GAP_OUTLIER_MS` (250ms) is treated
  as a tab-switch/gap artifact and discarded rather than counted — but left unbounded, a device
  rendering below ~4fps produces such a delta on *every* frame, so `deltas` would never fill and
  the verdict would stay `pending` forever on precisely the worst-performing devices. Bounded via a
  consecutive-outlier counter: 5 in a row resolves straight to `over`, while an isolated one (a
  genuine hide/show gap) still doesn't trip it.
- [x] **Watchdog wiring — corrected during advisor review, do not implement the original
  "feed the probe from `runTick`" idea:** boot does not populate `transitionsRef` (it's a pure
  CSS stagger — verified by grepping `transitionsRef.current.set` call sites, both of which are
  the crawl and delta-retarget effects, neither of which fires at mount), so in
  `transitions-only` mode `loopShouldRun()` is false at boot and `runTick` never runs — a probe
  fed from it would silently collect zero samples and never reach a verdict. Instead: a
  **standalone, self-cancelling boot-time sampling loop**, independent of `ensureLoop`/
  `loopShouldRun`, started on mount whenever the mount-time mode is `full` or `transitions-only`
  (nothing to measure/demote-from if already `static`). It calls its own
  `requestAnimationFrame` chain, feeds `createFrameBudgetProbe()`, and stops itself the frame it
  gets a non-`"pending"` verdict. On `"over"`: call `demoteToStatic()`, then run the existing
  reduced-motion-style snap (for each `transitionsRef` entry, if any exist by then, write final
  body/via state, clear the map, cancel any loop) — factor that snap block (it already exists in
  two places) into a shared `snapTransitionsToTarget()` and reuse it here as the third caller,
  rather than adding a fourth copy. **Corrected post-review:** the loop also re-checks the *live*
  mode (`staticModeRef`, kept current every commit) on every step, not only at mount — a later OS
  preference change flipping the live mode to `static` mid-sampling now stops the loop instead of
  continuing to sample despite static mode's "never schedules a frame" invariant.
- [x] CSS in `styles.css`, same block as `circuit-draw`/`circuit-via-in`: a `circuit-idle-glow`
  keyframe (opacity pulse, ease-in-out alternate, ~3.2s) applied to the **root `<svg>`**, never to
  either inner `.circuit-field-glow` group — a root-level opacity contains both groups and
  rasterizes them together once before alpha applies, which is structurally different from
  Session C's removed group-level `opacity: 0.55` (two independently filtered siblings compositing
  over each other) and does not reintroduce that bug. **Corrected post-review:** the animation
  lives on a separate `.circuit-field-idle-glow` class, JS-applied (`capability.ts`'s
  `canShowIdleGlow`) only when `static` came from a touch/pointer signal — `(update: slow)`,
  reduced-data, low `hardwareConcurrency`, and frame-budget-watchdog demotion all leave
  `.circuit-field-static` without it, so a permanent compositor animation never lands on a device
  that's in static mode *because* it can't afford motion. `.circuit-field-idle-glow { animation:
  none }` still sits in the `prefers-reduced-motion` block as defense in depth, even though
  `canShowIdleGlow` already excludes reduced-motion from ever getting the class. Boot draw-in is
  already skipped in static mode via `staticModeRef` reusing the existing snap branch — no extra
  CSS needed for that part.
- [x] Tests: new `test/capability.test.ts` (full `decideMotionMode` matrix, including
  `coarsePointer + hardwareConcurrency: 8` → static — the case a naive concurrency-only rule
  gets wrong — and `hardwareConcurrency: undefined` not demoting); new `test/frame-budget.test.ts`
  (steady 33.3ms deltas → ok, steady 50ms deltas → over, mixed baseline+dropped-ratio → over,
  `pending` under 40 samples, warmup samples excluded); extend
  `test/circuit-field-hooks.test.ts` for `useMotionMode` (synchronous mount-time decision, one-way
  ratchet survives a preference flipping back); new jsdom `visibilitychange` test (stubbed
  `document.visibilityState` + counting `requestAnimationFrame`: zero further scheduling after
  hide, `startTime` rebased on show). **This jsdom test is the real coverage for "background-tab
  check (rAF actually stops)"** — the Chrome-extension harness cannot validate it live (Session
  D's log: the controlled tab reports `visibilityState === "hidden"` permanently), so live
  validation is "no console errors, resumes cleanly" only, not a rAF-stops assertion.
- [x] Validate: file-scoped eslint/typecheck, full `pnpm --filter @unimatrix/ui exec vitest run`,
  `pnpm check`. Live on all 3 apps: DevTools CPU throttling to trip the watchdog and confirm
  demotion snaps in-flight crawls (not freezes them mid-draw); reduced-motion/reduced-data
  emulation; mobile-width + touch emulation on a card-dense route (`/projects`) to confirm the
  coarse-pointer → static path and glow pulse read correctly. Do not attempt a live hidden-tab
  rAF-stops check (see above) — jsdom test is authoritative.
- [x] Commit, PR.

#### Session E2 — Idle packets + idle line-shift (separate branch, cut after E1 merges)

Covers original bullets 1, 2. Gated behind `mode === "full"`; on `transitions-only`/`static`
neither feature mounts or schedules.

- [ ] `idle-packets.ts` (new, pure, zero React): `buildPacketGraph(bodies)` from **live
  `liveBodyRef` bodies at settle, not `CircuitTree.adjacency`** — live geometry includes scroll
  retargets and idle shifts, generation-time adjacency goes stale the first time a tip moves.
  (Note for the record: `CircuitTree.adjacency` therefore stays unconsumed in production,
  exercised only by `test/trace-generation.test.ts` — stating this explicitly since a stale
  positive claim in this doc already cost a session, per Session C's correction note above.)
  Built once per settle (`packetGraphRef` + `graphDirtyRef`, rebuilt on the first idle frame
  where `transitionsRef.size === 0 && graphDirtyRef`), not per frame — cost is O(total live
  points), amortized instead of running at 60/s. Packets are suspended and hidden while any
  transition is in flight (a packet walking stale geometry would visibly float off the line).
- [ ] Pooled packet elements, mirroring the existing `intersectionElRefs` direct-ref pattern
  exactly: fixed `IDLE_PACKET_POOL_SIZE = 12` (deliberately not scaled by `traceCount` — the pool
  is a perf ceiling, density comes from spawn rate), `freeSlotsRef` stack, direct `x`/`y`/`opacity`
  writes per idle frame, never a React re-render.
- [ ] Walk semantics: `PACKET_STEP_MS = 110` per grid cell, linear (not eased) interpolation.
  Junction split: continue down one option, fork down a second **only if a free slot exists**
  (pool exhaustion = no fork, never queued/preempting) — max one fork per junction. Retire on
  dead end or `PACKET_MAX_HOPS = 40`. Spawn from graph leaves on jittered
  `PACKET_SPAWN_INTERVAL_MS = 900` while under `IDLE_PACKET_MAX_CONCURRENT = 8` (4 slots headroom
  for splits). No per-packet occlusion query — traces already route through negative space, so
  packets inherit it for free.
- [ ] `idle-shift.ts` (new, pure, zero React): `pickIdleShiftIds` — **round-robin cursor over
  `traceIds`, not random** (even coverage, no starvation, deterministic/testable), batch of 2,
  eligibility = not mid-crawl and past a cooldown on the existing `lastRetargetAtRef` map (shared
  with scroll-retarget, so the two mechanisms can never double-move the same trace within a
  cooldown window). `idleShiftTip` is a **sibling of `retargetTip`, not a caller of it** — this
  was caught during advisor review: `retargetTip` requires `weight > currentWeight`, which is
  `null` for nearly every trace on an unoccluded page (flat weight 1 everywhere) and for most
  tips even on occluded pages (the generator already avoids occlusion, so tips already sit near
  weight 1). Reusing it verbatim would make idle line-shift a near-total no-op, contradicting
  "periodically retarget a few trace ids" actually being visible. `idleShiftTip` keeps the same
  in-line-axis constraint and occupied/own-cell collision checks, but accepts `weight >=
  currentWeight - IDLE_SHIFT_WEIGHT_TOLERANCE` (~0.05), choosing uniformly among valid ±1–2-cell
  candidates — visible ambient drift on any page, never drifting *into* an occluder.
  **Leash against unbounded wander (caught during advisor review):** a single-step
  `lastIdleTipRef` only blocks A→B→A, not a A→B→C→D... random walk drifting a tip 10+ cells from
  its generated position on a long-lived open tab. Add a `generatedTipCellRef: Map<id, string>`
  captured once at settle (not touched by subsequent shifts); reject any idle-shift candidate more
  than `IDLE_SHIFT_MAX_DRIFT_CELLS = 3` (Chebyshev/grid distance) from that anchor. Scroll-retarget
  is unaffected (it's occlusion-driven, not drift-driven, and already tends to move a tip back
  toward the anchor rather than away from it).
  Scheduled from the idle branch of `runTick` on a jittered ~9s interval (`now -
  lastIdleShiftAtRef.current > IDLE_SHIFT_INTERVAL_MS`) — no `setInterval`, which would keep
  firing while hidden and defeat E1's visibility gate.
- [ ] Handoff into Session B's engine, no second crawl implementation: extract the existing
  delta-retarget handler's post-`candidateIds` logic into a shared `applyRetargets(entries, now)`
  — same `buildRoute` → sparse-points write → `lastRetargetAtRef` stamp →
  `transitionsRef.set` → `ensureLoop()` chain, same static-mode snap branch — called by both the
  scroll-delta handler and the idle scheduler. Idle-shift scores against a ref mirror of
  `useCircuitOccluderRects()` (no fresher delta snapshot to use, unlike the scroll path).
- [ ] Hard Invariants idle line-shift must not violate (all inherited via the shared
  `applyRetargets` path, not re-derived): axis-aligned (in-line nudge only, same reason Session D
  reworked away from a 2D elbow search); exact GRID multiples (`clampToLattice` + the existing
  re-`snap()` on the densified body); no loops (`occupied` + `ownCells` collision check per
  candidate cell); vias only at real bends (`recomputeCorners`, unchanged); stable slot identity
  (idle-shift only ever mutates `liveBodyRef`/`previousTracesRef`/`transitionsRef` for ids that
  already exist — never touches `traceIds`/`traceCount`/`targetTraces`).
- [ ] CSS: `.circuit-field-packet` fill at 85% primary (brighter than the 60% strokes/vias, reads
  as moving current) — no keyframe, motion is JS-driven.
- [ ] Tests: new `test/idle-packets.test.ts` (`buildPacketGraph` neighbor symmetry/leaf/junction
  detection, plus a cross-module check that it stays a single connected component over real
  `generateTraces` output; `chooseNextCell` never returns `cameFrom`, forks only at junctions with
  a free slot; `packetPosition` stays axis-aligned between cell centers; pool-cap never exceeded).
  New `test/idle-shift.test.ts` (`pickIdleShiftIds` round-robin fairness/cooldown/wraparound;
  `idleShiftTip` returns a candidate with zero occluders present — the regression guard against a
  future refactor collapsing this back into `retargetTip` — stays on-lattice, final-segment-axis
  only, never occupied/own-cell, never the drift anchor beyond `IDLE_SHIFT_MAX_DRIFT_CELLS`).
  `test/scroll-retarget.test.ts` re-run unchanged to confirm the `applyRetargets` extraction is
  behavior-preserving; `trace-generation.test.ts`/`circuit-occluder.test.tsx` need no new cases
  (generation and the occluder provider are untouched by E2).
- [ ] Validate: file-scoped eslint/typecheck, full `pnpm --filter @unimatrix/ui exec vitest run`,
  `pnpm check`. Live on all 3 apps at desktop width (packets/idle-shift only exist in `full`
  mode — a coarse-pointer/mobile pass correctly shows neither; don't read that as a bug). Watch
  for: a packet floating off a line mid-crawl (suspend flag wrong), a packet stuck visible after
  retiring (slot-return bug), idle drift producing a diagonal (would mean `idleShiftTip` diverged
  from the axis constraint), and unbounded drift on a long-idle tab (leash bug).
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
- **Occlusion scope (Session C, resolved by Session D.5 — see Design intent clarification
  above):** Session C deliberately registered only header/main (web, cube-trainer) and zero
  occluders (auth), reasoning that per-card registration on auth would make density visibly
  differ between near-identical routes. Session D.5 resolved this: the actual goal is circuits
  routed through negative space around real rectangular content (cards, panels, footer, nav), not
  just two or three broad containers. All 5 auth routes now register (a direct `Card` ref for
  `index`/404, a minimal wrapper `div` around each Clerk widget for `sign-in`/`sign-up`/`account`,
  since Clerk's hosted components don't forward a ref); `mainRef` was removed entirely from web
  and cube-trainer in favor of per-content-block registration. The "soft everywhere" rule itself
  (immediately above) is unaffected, only *what* gets registered changes.
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
- Session B: Done. Replaced the single shared `tick()`
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
  traces, no via flicker on early-finishing traces, console clean on all three. Committed and
  PR'd — PR #49, merged into `main`.
- Session C: Implementation and manual browser validation done. Planned on a fresh branch
  (`feat/circuit-field-occlusion-generation`, cut from `origin/main` post-PR#49) via Claude
  Code plan mode rather than editing this doc directly — see git history for the full plan
  content. Departed from this doc's literal "build tree then decompose into N branches"
  phrasing: grows the tree as exactly `count` branches directly instead (each branch is one
  tree edge from birth), since decomposing an arbitrary tree into an exact branch count isn't
  generally possible without a retracing hazard that violates the no-loops invariant — see the
  Session C checklist above for the reasoning. Caught two real bugs during test-driven
  verification of the new generator, both fixed before moving on: branch 0's unconstrained
  random walk had no self-collision guard (two segments could cancel out and retrace the same
  cells — the invariant test caught this immediately as "trace t0 closed a loop"); reusing
  `route-engine.ts`'s `densify`-based connector helpers for generation output (not just
  live-crawl rendering, their only prior use) introduced floating-point drift a fractional
  epsilon off the GRID lattice (`1/3` in binary) — fixed with an explicit `snap()` pass on the
  returned body, scoped to `trace-generation.ts` only rather than touching the shared
  `densify`/route-engine code other live-rendering paths depend on. `packages/ui`: full
  `vitest run` (54 assertions across trace-generation/occlusion/circuit-occluder/ui suites),
  `eslint`, and `tsc --noEmit` all clean; `pnpm --filter @unimatrix/ui build` clean. All 3
  app-shells (`web`, `cube-trainer`, `auth`) lint/typecheck clean after wiring. Confirmed
  `--card` is opaque (no alpha) in `packages/ui/src/styles.css` before relying on "translucent
  panels dim traces for free" — only true for web's `.site-panel` header; auth/cube-trainer get
  density reduction only, not visible dimming, a real cross-app behavior difference worth
  stating in the PR body rather than asserting uniform behavior. Manual browser validation (all
  3 dev servers, desktop + mobile widths on web, route-change crawl) caught two real bugs the
  automated suite couldn't see, both fixed: (1) `useCircuitOccluder(headerRef/mainRef)` was
  called directly inside `AppShell` in web and cube-trainer — the same component that renders
  `CircuitOccluderProvider` as its own child — so the hook's `useContext` could never see that
  Provider (a component can't consume a context it renders as its own descendant); split each
  into an outer `AppShell` (renders the Provider) + inner `AppShellContent` (calls the hook),
  confirmed via the "called outside a CircuitOccluderProvider" dev warning disappearing after
  the fix. (2) User-reported: overlapping/crossing traces visibly brighter where they touched —
  traced to `.circuit-field-glow`'s pre-existing `opacity: 0.55` (in `packages/ui/src/styles.css`,
  untouched by earlier sessions' file changes) compositing overlapping opaque strokes brighter
  than intended; the old greedy generator rarely produced true coincident geometry so this was
  rarely visible, but the new spanning-tree generator's real T-junctions/crossings exposed it
  routinely. Fixed by dropping the group `opacity` and dimming the stroke/via fill color directly
  via an opaque `color-mix(in oklab, var(--primary) 60%, var(--background))` instead — dims the
  same amount without the double-blend-at-overlap artifact, since overlapping *opaque* strokes
  just paint solid instead of compositing translucently. A third report (a via appearing
  mid-straight-line) did not reproduce in a settled, undisturbed DOM check — of 92 visible via
  rects on a loaded page, 0 mismatched their owning path's real corners/endpoints in a clean
  check; the several mismatches an earlier attempt found matched the profile of samples taken
  mid-crawl (fractional/exact coordinate pairs, an active-transition signature) rather than a
  settled-state defect. Flagging as unconfirmed rather than closed — if it recurs on a fully
  idle page, worth a closer look with `prefers-reduced-motion` forced on (removes crawl
  interpolation as a variable entirely).
- Session D: Planned on a fresh branch (`feat/circuit-field-scroll-reactivity`, cut from
  `origin/main` post-PR#50) via Claude Code plan mode, with a Plan subagent doing the first-pass
  design to keep the planning session's own context small (per user request) — see git history
  for the full plan content. The subagent's first-pass design for the scroll-retarget mechanism
  (bullet 1) was caught, before any code was written, as inert-as-scoped: it assumed
  scroll-fresh occluder rects alone would give the retarget path something to react to, but
  web's `mainRef` (a window-scrolling `<main>`, full page-content height) blankets the entire
  viewport at a flat `OCCLUDER_MIN_WEIGHT` for most of any scroll range regardless of how
  fresh the measurement is — `occlusionWeightAt`'s min-combine doesn't distinguish depth inside a
  rect. Caught via a static-analysis pass (`advisor()`) before implementation started, confirmed
  by reading `apps/web/src/app/app-shell.tsx` in full and the arithmetic in `occlusion.ts`. User
  chose to fix the root cause (occluder granularity — see the new checklist item above) rather
  than ship dead plumbing or descope to just the URL-bar fix.
  Implementation: `useCircuitOccluder(ref, { maxHeightPx })` caps a tall registrant's counted
  height (web's `mainRef` only; `headerRef`/`condensedHeaderRef` stay uncapped, already
  self-bounded; cube-trainer's `mainRef` left uncapped — confirmed centered non-scrolling layout,
  not a tall scrolling column). `CircuitOccluderProvider` now tracks measurements per-registrant
  (`Map<symbol, Occluder>`) and diffs on every pass; a `scroll` listener triggers a measurement
  but only ever notifies a new `useCircuitOccluderDelta` subscription (never `setRects`) — kept
  strictly separate from the existing `ResizeObserver`-driven structural path so scrolling can
  never re-trigger `targetTraces`'s full `generateTraces`/`estimateEffectiveArea` cost, the exact
  thing an earlier (pre-Session-D) attempt got reverted for. New `scroll-retarget.ts` (pure,
  zero React): `retargetTip` originally searched a 2D neighborhood via an elbow connector
  (mirroring `route-engine.ts`'s `buildRoute`), but that was reworked mid-session — an elbow
  whose leg orientation happened to clear collisions could still produce a diagonal once spliced
  back into the trace's *sparse* control-point list (only real corners, not every dense-body
  step), since the safe elbow orientation there is forced by the sparse polyline's existing
  direction, not free to pick for collision-avoidance. Simplified to an in-line nudge — extend
  or retract along the tip's own final-segment axis only — which is trivially safe for both the
  dense body and the reconstructed sparse list, at the cost of a narrower (1D, not 2D) search.
  `circuit-field.tsx`'s new effect reuses Session B's transition engine exactly
  (`buildRoute`/`transitionsRef`/`runTick`) for the actual crawl, skips any trace already
  mid-crawl (its `liveBodyRef` entry is a partial `sliceWindow`, not real geometry to retarget
  from), and writes `previousTracesRef` with the *sparse* point list (not the densified body) so
  the next legitimate regeneration's skip-if-unchanged check keeps working for a retargeted
  trace. `useDebouncedSize` gained `heightJitterIgnorePx`; a first-pass implementation had a real
  bug caught before it shipped — returning a per-render cleanup that calls `clearTimeout`
  unconditionally, which React invokes on every dependency change (including a jitter-classified
  "do nothing" render) before that render's own early-return logic ever runs, silently cancelling
  a real in-flight resize's pending commit. Fixed by only clearing inline right before
  rescheduling, plus a separate mount/unmount-only cleanup effect; the exact regression case
  ("a jitter sample does not cancel a real in-flight resize's pending commit") is now a test.
  New `test/scroll-retarget.test.ts` (10 cases: affected-tip detection, footprint building,
  strict-improvement nudge, boxed-in/no-improvement/sole-ownership/self-retrace null cases) and
  `test/circuit-field-hooks.test.ts` (6 cases for `useDebouncedSize`, including the bug above).
  `test/circuit-occluder.test.tsx` extended with 5 cases (`maxHeightPx` clamping, scroll-delta
  fire/no-fire, scroll-never-touches-`useCircuitOccluderRects` regression guard, structural
  changes not double-firing delta). Also corrected a false claim in the Session C checklist above
  (`test/occlusion.test.ts` was never created — flagged separately there). `packages/ui`: full
  `vitest run` (75 assertions across trace-generation/scroll-retarget/circuit-field-hooks/
  circuit-occluder/ui suites), `eslint`, and `tsc` all clean. Real-browser manual scroll
  validation (web only, via the Chrome extension against the dev server): discovered mid-check
  that `apps/web` consumes `packages/ui`'s built `dist/`, but a live Vite dev server actually
  resolves the workspace package straight from `src/` via `@fs/...` (confirmed by reading the
  loaded module's URL in a console stack trace) — `dist/` only matters for `apps/web`'s own
  production build, so the earlier `pnpm run build` step taken out of caution wasn't strictly
  needed for this dev-server check, but rebuilding at the end so `dist/` isn't left stale is
  still correct. Confirmed live: scroll listener attaches and fires on real scroll, structural
  (`ResizeObserver`/register/unregister) and scroll-delta code paths both reachable with no
  console errors, page renders cleanly through a scroll spanning a forced-tall `<main>` (no
  diagonal seams, no visual corruption). Could not confirm the rAF-gated commit/retarget step
  actually firing: this automation session's controlled tab reports
  `document.visibilityState === "hidden"` permanently (even with `document.hasFocus() === true`
  after clicking into the page), which throttles `requestAnimationFrame` to zero in Chrome — a
  property of this specific harness, not something a real user's foregrounded tab would hit, and
  not something the shipped code does differently for hidden tabs (no visibility-gating was
  added, deliberately, since that's Session E's "stop the loop on `document.hidden`" scope, not
  Session D's). The same rAF-gated diff/notify logic this couldn't observe live already has
  direct passing coverage in `test/circuit-occluder.test.tsx` under jsdom, where
  `requestAnimationFrame` isn't visibility-gated — so the logic itself is tested, just not this
  specific live-browser firing. Flagging this gap explicitly rather than claiming full visual
  confirmation: **a real mobile device or a non-automated browser check is recommended before
  merging**, specifically to watch a trace actually retarget near `mainRef`'s capped edge.
- Session D.5: Done. Implemented per a Planner-agent (opus) plan reviewed before writing code.
  `mainRef` registration removed from all three shells (web, cube-trainer) — a window-scrolling
  container spanning full page content blankets most of the viewport at a flat weight regardless
  of what's on the page, which made per-card registration a no-op underneath it. Registered real
  content blocks instead: web's `PublicSiteFooter` footer and `PublicLinkedSurface`'s `Card` (one
  funnel covering every project/blog list card site-wide), both `about` route panels, and the
  project/blog detail article panels (capped, since an article can run taller than a viewport) plus
  their not-found panels; cube-trainer's learn/trainer panels, the two home-route mode tiles (via a
  new `ModeTile` component — a hook can't be called per `.map()` iteration), and the learn/drill
  case-group sections (registering the group wrapper, not each `CasePreviewCard` — 50+ registrants
  would blanket uniformly at any reasonable falloff and buy nothing); auth's `WelcomeCard` and the
  404 boundary `Card` directly, plus a minimal wrapper `div` around each of `sign-in`/`sign-up`/
  `account`'s Clerk widget (Clerk's hosted components don't forward a DOM ref) — all 5 auth routes
  now register, superseding Session C's "2 of 5" zero-coverage call. Split `OCCLUDER_FALLOFF_PX`
  (retuned to `GRID * 1.5`, tunable) from a new `OCCLUDER_AFFECT_MARGIN_PX` (pinned at the old
  `GRID * 4`) specifically so retuning the visual falloff could never shrink Session D's
  scroll-retarget trigger margin — the two were reading as the same constant purely by
  coincidence, not because they needed to move together. Added a value-equality guard to
  `CircuitOccluderProvider`'s structural `flush()`: with ~15 registrants on a card-dense route,
  independently-async ones (e.g. `ProjectStatusBadge`'s per-card live-status query resolving on
  its own schedule) would otherwise each trigger their own full `targetTraces` recompute even when
  nothing actually moved; a structural pass whose measurement is unchanged from last time now
  skips the commit. Renamed `MAIN_OCCLUDER_MAX_HEIGHT_PX` to `TALL_OCCLUDER_MAX_HEIGHT_PX` since
  its only remaining use is web's long-article panels, not an app-shell `<main>`.
  Live-browser validation (Chrome extension, dev servers for all 3 apps) caught two real bugs
  beyond the plan's own scope, both fixed and covered by the existing invariant/structural test
  suites (no exact-output snapshots exist, only structural assertions, so neither change required
  new test scaffolding): (1) **user-reported** — the spanning tree's root (branch 0's unconstrained
  walk start) always seeded from the single cell nearest the canvas's *geometric* center
  (`assignTargetCells`), with zero regard for occlusion; once occlusion covered real centered
  content (a card, a Clerk widget), the root visibly sat under it on every load. Fixed by scoring
  every candidate cell's center against `occlusionWeightAt` and picking the least-occluded as root,
  falling back to nearest-canvas-center on ties — which is every cell, unchanged, whenever nothing
  is registered, so pages with no occluders produce byte-identical root placement to before. The
  rest of the cells now sort by distance from the *actual* root rather than from the abstract page
  center, which is arguably more correct for the boot-animation depth ordering too (Session A's
  "radiate outward" intent literally means outward from the root). (2) **user-reported** —
  connecting segments between an already-placed anchor and a new target pad could cut straight
  across a card's interior even though `pickTargetPoint` had kept the target *endpoint* itself
  outside it: `attachRoute`'s elbow-candidate selection checked only for collision against other
  traces' `footprint`, never against occlusion, so whichever of the two elbow orientations
  (horizontal-then-vertical vs. the reverse) was tried and found collision-free first — regardless
  of how much of it crossed occluded ground — won automatically. Fixed by scoring both
  collision-free candidates by summed `1 - occlusionWeightAt(...)` along their densified points and
  keeping the lower-cost one; still soft (a hard reject was never the goal, and the BFS corridor
  fallback for when both elbows collide with existing footprint remains occlusion-unaware — flagged
  as a known remaining gap, not fixed this session since it's the rarer path). Both fixes are pure
  weighting/selection changes with no effect on the acyclic-construction guarantee or the Hard
  Invariants; `test/trace-generation.test.ts`'s structural assertions (axis-aligned, on-lattice,
  single connected component, edges == vertices − 1) passed unmodified both before and after.
  `packages/ui`: `pnpm exec eslint`, `pnpm --filter @unimatrix/ui typecheck`, and
  `vitest run test/circuit-occluder.test.tsx test/scroll-retarget.test.ts test/trace-generation.test.ts`
  all clean throughout. All 3 app-shells' file-scoped eslint/typecheck clean; `apps/web`'s
  `test/public-ui-usage.test.ts` (updated for the constant rename), `apps/cube-trainer`'s full
  `vitest run` (266 passed, 9 pre-existing skips), and `apps/auth-app`'s `test:unit` (which also
  rebuilds `packages/ui`'s `dist/`) all green. Live-browser validation via the Chrome extension
  covered web (`/`, `/projects`, `/about`, a project detail route), cube-trainer (`/`, `/learn`),
  and auth (`/`, `/sign-in`) — zero console errors on any route, and both user-reported issues
  above were confirmed fixed by re-screenshotting after each patch. Not independently re-confirmed
  this session: blog list/detail with real multi-entry content (seed content only has one project
  and one placeholder post, so the "card-dense route" scenario is thin in practice), and the BFS
  corridor fallback path specifically (rare — only triggers when both elbow orientations collide
  with existing trace footprint).
  **Recommend a card-dense real-content check before merging**, since the seed content doesn't
  exercise the many-registrant path this session's `setRects` equality guard was written for.
  Separately, `pnpm verify` surfaced 3 pre-existing `apps/web` test failures unrelated to any of
  the above (confirmed via `git stash` against the clean pre-session tree, same failures): the
  "auth disabled" scenario tests (`api-client.disabled.test.ts`, `require-auth.test.tsx`,
  `status-route.test.tsx`) each read `VITE_CLERK_PUBLISHABLE_KEY` at module scope through some
  import chain, and none of them stubbed it unset — so a developer with a real Clerk key in their
  own `.env.local` (as this session's environment had) gets `authEnabled: true` ambiently, which
  then throws trying to render `<SignedIn>`/`useAuth()` with no `ClerkProvider` mounted in the
  test's own tree. The fix pattern already existed in the repo (`api-client.enabled.test.ts`'s
  `vi.resetModules()` + `vi.stubEnv(..., value)` + dynamic import) but only for the "enabled" half
  of the pair — applied the missing `vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", undefined)`
  counterpart to all 3 "disabled" tests, converting `require-auth.test.tsx`/`status-route.test.tsx`
  to dynamic imports so the stub takes effect before the module (which computes `authEnabled` once,
  at import time) is evaluated. `pnpm verify` now fully green (44/44 tasks, including both apps'
  Playwright smoke suites).
- Session E1: Planned via a Planner-agent (opus) pass, then `advisor()` reviewed before writing
  code. Advisor caught one inertness-class issue before implementation, same shape as Session D's
  "inert-as-scoped" catch: the planner's watchdog design fed the frame-budget probe from `runTick`
  itself, but `runTick` only runs while `transitionsRef` is non-empty, and boot (verified by
  grepping `transitionsRef.current.set` call sites in `circuit-field.tsx`) is a pure CSS stagger
  that never populates it — so in `transitions-only` mode the probe would silently collect zero
  samples and never demote. Fixed in the plan doc (see Session E1 checklist above) with a
  standalone self-cancelling boot-time sampling loop instead. Advisor also flagged two of the
  planner's five open questions as already-settled by this doc's own "Decisions" section
  (coarse-pointer→static and reduced-data→static) rather than new questions for the user, and
  deferred the other two (idle line-shift's near-inertness via `retargetTip`, packet visual
  constants) to E2 as that session's own call. Implementation done, on
  `feat/circuit-field-idle-capability` (cut from `origin/main`, already past PR #52/D.5).
  `capability.ts` (`MotionMode`, `decideMotionMode`, `mostRestrictive`) and `frame-budget.ts`
  (`createFrameBudgetProbe`) new, zero-React, per plan. `useMotionMode()` added to
  `circuit-field-hooks.ts` — lazy-synchronous initial state (no effect-based flash of the wrong
  mode), one-way ratchet via a `runtimeFloorRef` separate from the live-recomputed OS-preference
  state. `circuit-field.tsx`: `reducedMotionRef` replaced by `staticModeRef` at all 5 sites;
  `ensureLoop`/`loopShouldRun` centralize the 3 previously-separate `requestAnimationFrame(runTick)`
  call sites behind a `documentHiddenRef` guard; `snapTransitionsToTarget`/
  `snapAllInFlightTransitions` extracted from the two duplicated "skip the crawl, write final
  state" branches (crawl-pass static-mode branch, retarget static-mode branch) and reused a third
  time by the watchdog's demotion path — net code reduction despite the new watchdog/visibility
  logic. `idleEnabledRef` and the `hasTransitions` gate from the planner's original pass were
  **not** implemented this session (correction made before writing code, not after): the
  corrected watchdog design uses a standalone probe loop rather than piggybacking on `runTick`, so
  nothing in E1 ever runs the shared loop while `transitionsRef` is empty — gating dead code would
  have been premature. Both are deferred to E2, which actually needs them once idle producers
  exist.
  A real bug surfaced by the new `circuit-field-visibility.test.tsx` (written to cover the
  "background-tab check (rAF actually stops)" validation step, since the Chrome-extension harness
  can't observe it live — see Session D's log for why): the frame-budget watchdog's own probe rAF
  loop was a second, independent `requestAnimationFrame` consumer that **wasn't gated by
  `documentHiddenRef` at all** — the test caught real frame counts still climbing during a
  simulated hide. Fixed by giving the watchdog its own `watchdogFrameRef`/`watchdogStepRef` pair
  that the same `visibilitychange` handler pauses/resumes alongside the main loop; a large
  resume-gap delta reads as a single discarded outlier in `frame-budget.ts` (bounded post-review to
  a run of 5 consecutive before it resolves `over` on its own — see that session's fix above), so
  an isolated hide/show cycle mid-sampling still can't wrongly trip the verdict. This is exactly
  the class of bug the "write the test the plan already committed to" step exists to catch — worth
  noting since it would have shipped invisibly otherwise (real hidden tabs throttle rAF at the
  browser level regardless, so it's not user-visible in production, but it defeats the point of
  building explicit visibility-awareness at all).
  One test-file fix along the way: `ReturnType<typeof vi.spyOn>` doesn't type-check cleanly against
  a specific overload (`vi.spyOn(window, "requestAnimationFrame")`) on this vitest/TS version;
  replaced with a plain call-counting wrapper around the real `requestAnimationFrame` instead of
  fighting the generic — simpler and avoids the same class of type gymnastics recurring elsewhere.
  Validation: `pnpm --filter @unimatrix/ui typecheck`/`eslint`/`vitest run` (102/102, up from 77 —
  25 new: 13 capability + 7 frame-budget + 4 useMotionMode + 1 visibility, net of the pre-existing
  suite) all clean; `pnpm check` fully green (38/38 tasks) across every workspace. Live-browser
  validation via the Chrome extension on all 3 apps (dev servers, real browser): zero console
  errors on any route (web `/`, `/projects`; cube-trainer `/`; auth `/`), confirmed live that a
  12-core/fine-pointer/no-reduced-motion environment correctly resolves to `full` mode (plain
  `circuit-field` class, not `-static`) by reading the mounted DOM directly, and confirmed a live
  `document.hidden`/`visibilitychange` toggle cycle (faked via `Object.defineProperty` +
  dispatched event, same technique as the jsdom test) doesn't throw or leave console errors.
  **Not confirmed live** (recommend before merging): CPU throttling to trip the frame-budget
  watchdog's demotion path, and `(pointer: coarse)`/`prefers-reduced-motion`/
  `prefers-reduced-data` media-query emulation — the sandboxed devtools-protocol plugin available
  in this environment has no standalone Chrome binary to launch, and the Chrome-extension
  integration used for the rest of this session's live checks doesn't expose CPU/media emulation.
  The `static`-mode CSS/rendering path itself has strong non-live coverage instead: the
  `staticModeRef` branches are the same code paths `prefers-reduced-motion` already exercised
  pre-E1 (renamed, not rewritten), and `decideMotionMode`/`useMotionMode`/the frame-budget ratio
  math all have direct unit coverage of the exact boundary conditions (baseline+ratio arms,
  coarse-pointer-overrides-high-concurrency, one-way ratchet) — but an actual visual check of a
  throttled/coarse/reduced-motion device rendering `.circuit-field-static`'s glow-pulse fallback
  has not happened on a real device or emulator.
- Session E2: _not started_ — separate branch, cut fresh from `origin/main` after E1 merges.
