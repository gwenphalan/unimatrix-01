# @unimatrix/ui

Shared ShadCN-based UI primitives for the Unimatrix monorepo.

## Current model

- `src/components/ui/*` is the built-in shadcn surface for shared primitives
- `@unimatrix/ui` remains the full shared UI surface for broad cross-app consumers
- `@unimatrix/ui/public` is the narrowed public-safe surface consumed by every app and by `@unimatrix/chrome`
- `apps/web` owns public-site compositions such as frames, section headings, cards, and route-specific layout pieces
- `apps/web/src/styles.css` layers site-specific presentation on top of `@unimatrix/ui/styles.css`

`PublicMarkdown` provides safe GitHub-flavored markdown rendering for authored content.

