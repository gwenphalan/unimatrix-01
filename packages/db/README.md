# @unimatrix/db

Minimal persistence boundary for the Unimatrix monorepo.

## Local workflow

- default SQLite file: `packages/db/local/unimatrix.sqlite`
- `DATABASE_URL` override forms:
  - absolute filesystem path
  - repo-relative filesystem path
  - `file:` URL
  - `:memory:`

This package stays SQLite-first; new tables belong in `src/schema` behind the shared barrel rather than as ad hoc, package-local connections.
