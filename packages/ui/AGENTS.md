# AGENTS.md

## 1. Overview
`packages/ui` is the shared UI boundary for the monorepo. It hosts the canonical shadcn primitive surface, shared styles, and safe markdown rendering that other workspaces consume.

## 2. Core Behaviors & Patterns
- **Shared primitive surface**: Keep broadly reusable primitives in `src/components/ui/*` and export them through the package barrels. App-specific compositions belong in the consuming app, not here.
- **Three export surfaces**: `.` (full barrel), `./public` (narrowed surface every app and `@unimatrix/chrome` consume), `./editor` (the CodeMirror markdown editor in `src/components/markdown-editor/`, consumed by `apps/web`'s admin features). Add to `public.ts` only when the export should be safe and stable for the public-site app.
- **Safe markdown rendering**: `PublicMarkdown` sanitizes links, skips raw HTML, applies `remark-gfm`, and renders internal links through an injected callback. It also syntax-highlights fenced code blocks via `prism-react-renderer` with a custom theme and language-alias resolution. Markdown behavior changes should preserve that safe-rendering contract.
- **Shared styling**: `src/styles.css` carries shared tokens and base presentation; consuming apps layer their own styling on top instead of modifying shared styles to fit a single route.

## 3. Conventions
- **File naming**: kebab-case files, `PascalCase` exported components. Stay `PascalCase`.
- **Exports**: Re-export from `src/index.ts` or `src/public.ts` instead of forcing consumers to reach into deep component paths.
- **Scope discipline**: Do not move route loaders, content parsing, or public-site-only layouts into this package unless multiple workspaces need the abstraction.
- **Utilities**: Shared helpers stay small and composable; `cn`-style class merging and other generic helpers belong in `src/lib`, not mixed into component files unless they are component-specific.

