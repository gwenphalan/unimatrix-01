# AGENTS.md

## 1. Overview
`packages/e2e-helpers` holds shared Playwright assertion helpers for the app e2e suites: an accessibility scan and a page-error collector. It exists so two app suites do not keep their own drifting copies of the same assertion.

## 2. Folder Structure
- `src/accessibility.ts`: the shared accessibility scan.
- `src/page-errors.ts`: page-error collection.
- `src/index.ts`: the barrel.

## 3. Core Behaviors & Patterns
Test-only and **app-agnostic**. Helpers take the selectors, route labels, and accessibility baseline they act on as arguments. Anything that names a specific app belongs in that app's `e2e/*.spec.ts` instead.

## 4. Conventions
- Import it only from `e2e/`, never from `src/`.
- Consumers resolve it through a tsconfig `paths` entry pointing at `src/index.ts`, **not** through the `exports` map. Playwright will not transpile a path containing `node_modules`, so the symlinked resolution fails on raw TypeScript.
- Keep `@playwright/test` a **peer** dependency. Two resolved copies means `expect` cannot see the running test.

## 5. Working Agreements
The circuit-field occlusion-measurement helper that used to live here was removed with the circuit field itself (`f65333b`, #136). Do not reintroduce it or references to it.
