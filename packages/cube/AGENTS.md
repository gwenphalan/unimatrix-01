# AGENTS.md

## 1. Overview
`packages/cube` is the Rubik's Cube move engine, notation parser, and last-layer diagram geometry behind `apps/cflop`, its only consumer today. Two entry points: `.` (engine, notation, diagram geometry — no dependency of its own) and `./react` (the two diagram views, the one place this package touches React or `@unimatrix/ui`).

## 2. Core Behaviors & Patterns
- `rewriteAsOuterMoves` emits quarter turns only (`R'` comes back as `R R R`); pass its result through `simplifyMoves` before it reaches `movesToString`, never hand it there directly.
- `rewriteAsOuterMoves` throws on a sequence carrying a net whole-cube rotation — outer turns leave the centres fixed, so such a sequence has no outer-turn-only form at all.

## 3. Conventions
Source-only, on the `@unimatrix/chrome` model: consumers resolve `src/*.ts` through a Vite alias plus a tsconfig `paths` entry, so this package's tsconfig extends `base.json` rather than `library.json`. `.`'s promise of carrying no dependency is enforced, not just stated: `packages/config-eslint/restricted-imports.mjs` bans `react`, `react-dom` and `@unimatrix/ui` from every file under `src/` except `react.ts` and `components/**` — and bans reaching those two exempt paths as well, since a re-export from `index.ts` would carry the dependency just as far as a direct import.

## 4. Working Agreements
Same wiring requirement as `packages/chrome`: `@source "../../../packages/cube/src/**/*.{ts,tsx}"` in a consuming app's stylesheet, guarded by `infra/scripts/check-app-wiring.sh`.
