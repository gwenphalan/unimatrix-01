# Operating model

`unimatrix-01` is the TypeScript monorepo for the Unimatrix public site, API,
tools, shared packages, and authored content.

The operating model is current-first:

- Keep the repo runnable today.
- Preserve stable package and app boundaries.
- Document future surface only where it is clearly marked as reserved, and keep
  present-tense repo facts separate from it. A reserved path is not a runtime
  surface and must never be described as one.
- Keep the root scripts as the canonical workflow surface for both local work
  and CI, so the two cannot diverge.

The root `AGENTS.md` carries the rest and is the authority where they overlap:
which workspaces exist and which are reserved, what each package may depend on,
the toolchain pins, and the branch, commit, and PR rules. The workspace roster
itself is the filesystem — `pnpm-workspace.yaml` and `ls`, not a list committed
beside it.
