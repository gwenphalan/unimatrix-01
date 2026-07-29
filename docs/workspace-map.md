# Workspace map

Use this page to decide where code, docs, content, or infra changes belong.

## Where the map actually lives

This page used to carry a copy of the repo tree and a table of per-workspace responsibilities. Both
drifted: the table was missing `packages/chrome`, `packages/config-vitest` and
`packages/e2e-helpers` long after they went live, while the same facts stayed correct in
`AGENTS.md` — the file that is loaded on every session and therefore actually gets corrected.

So the duplication is gone rather than re-synchronised. There are now two sources, and neither
restates the other:

- **The filesystem** is the roster. `apps/*` and `packages/*` come from `pnpm-workspace.yaml`; `ls`
  answers "what exists" more reliably than any list committed next to it.
- **`AGENTS.md`** is the ownership boundary. Its *Workspace* section covers the naming traps and the
  reserved-but-not-live paths; its *Boundaries* section carries the per-package rules — what each
  package may depend on, what must not move into it, and which constraints fail silently.

Nested `AGENTS.md` files override the root for their subtree. Live examples: `packages/db/AGENTS.md`
for persistence, `.github/AGENTS.md` for CI and Dependabot mechanics.

## Placing a change

1. Find the narrowest workspace whose stated boundary already covers the concern, and put the change
   there.
2. If nothing covers it and the thing is reusable, it belongs in a shared package rather than copied
   into an app — see *Prefer shared-package composition* in `AGENTS.md`.
3. If a shared home would break a package's stated boundary, add the entry point or the package
   instead of reaching around the boundary.

## Related

- `docs/content.md` — how authored content is stored and published
- `docs/development.md` — local setup and the check commands
- `infra/deployment/README.md` — deployment topology
