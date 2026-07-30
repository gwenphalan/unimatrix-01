# Repository docs

This directory is the human operating guide for `unimatrix-01`. Start here
when the root `README.md` is too brief and you need the current repo
contract, local workflow, or content rules.

## Start here

Use these pages based on the kind of change you are making.

- [Operating model](./operating-model.md) for live versus reserved surface,
  repo boundaries, and branch or PR rules.
- [Development workflow](./development.md) for setup, commands, env
  bootstrap behavior, CI alignment, and database workflow.
- [Content workflow](./content.md) for authored content collections,
  validation rules, and manual registry updates.
- [Deployment docs](../infra/deployment/README.md) for runtime and
  deployment environment behavior.
- [Local container docs](../infra/docker/README.md) for the current local
  container posture.

Where a change belongs is answered by the root `AGENTS.md` — its *Workspace*
section for what exists and what is reserved, its *Boundaries* section for what
each package may depend on.
