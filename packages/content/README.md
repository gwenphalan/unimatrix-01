# @unimatrix/content

Typed content-system boundary for repo-backed authored content.

This package stays intentionally small and focused on the current public-site domains only:

- `content/home/index.md` for homepage and about copy
- `content/projects/*.md` for projects
- `content/blog/*.md` for blog entries

## Current API shape

- collection metadata in `src/collections.ts`
- pure parsing and validation helpers from the package root
- repo-backed Node loaders from `@unimatrix/content/node`

## Validation behavior

- invalid or missing fields throw a `ContentValidationError`
- errors include the repo-relative file path and failing field name
- excerpt derivation stays plain-text even when authored markdown includes GFM features such as tables, task lists, links, images, and fenced code

## Public v1 scope boundary

- current live public content is limited to `home`, `projects`, and `blog`
- repo-internal operating docs belong under `docs/`, not under `content/`
- operational queue-status posts, policy-page migrations, and future docs or notes collections stay out of scope unless a later issue expands the boundary
- `apps/web/src/features/content/site-content.ts` raw-imports `content/home/index.md` and nothing else
- `apps/web/test/content-registry.test.ts` keeps blog and project markdown *out* of the web bundle; a `?raw` import of blog or project markdown would be a second, silently stale source of truth beside the content database

