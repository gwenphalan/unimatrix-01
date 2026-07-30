# AGENTS.md

## 1. Overview
`packages/e2e-helpers` holds shared Playwright helpers for the app e2e suites: an accessibility scan, a page-error collector, and a route-navigation helper (`gotoRoute`). It exists so two app suites do not keep their own drifting copies of the same assertion.

## 2. Folder Structure
- `src/accessibility.ts`: the shared accessibility scan.
- `src/page-errors.ts`: page-error collection, plus `gotoRoute` for shared route navigation.
- `src/index.ts`: the barrel.

## 3. Core Behaviors & Patterns
Test-only and **app-agnostic**. Helpers take the selectors, route labels, and accessibility baseline they act on as arguments. Anything that names a specific app belongs in that app's `e2e/*.spec.ts` instead.

## 4. Conventions
- Import it only from `e2e/`, never from `src/`.
- Consumers resolve it through a tsconfig `paths` entry pointing at `src/index.ts`, **not** through the `exports` map. Playwright will not transpile a path containing `node_modules`, so the symlinked resolution fails on raw TypeScript.
- Keep `@playwright/test` a **peer** dependency. Two resolved copies means `expect` cannot see the running test.
