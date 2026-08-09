# AGENTS.md

## 1. Overview
`packages/ui` is the shared UI boundary for the monorepo. It hosts the canonical shadcn primitive surface, shared styles, and safe markdown rendering that other workspaces consume.

## 2. Core Behaviors & Patterns
- **Shared primitive surface**: Keep broadly reusable primitives in `src/components/ui/*` and export them through the package barrels. App-specific compositions belong in the consuming app, not here.
- **Three export surfaces**: `.` (full barrel), `./public` (narrowed surface every app and `@unimatrix/chrome` consume), `./editor` (the CodeMirror markdown editor in `src/components/markdown-editor/`, consumed by `apps/admin`'s CMS and by nothing else — `apps/web` does not resolve it). Add to `public.ts` only when the export should be safe and stable for the public-site app.
- **Safe markdown rendering**: `PublicMarkdown` sanitizes links, skips raw HTML, applies `remark-gfm`, and renders internal links through an injected callback. It also syntax-highlights fenced code blocks via `prism-react-renderer` with a custom theme and language-alias resolution. Markdown behavior changes should preserve that safe-rendering contract.
- **Shared styling**: `src/styles.css` carries shared tokens and base presentation; consuming apps layer their own styling on top instead of modifying shared styles to fit a single route.

## 3. Conventions
- **File naming**: kebab-case files, `PascalCase` exported components. Stay `PascalCase`.
- **Exports**: Re-export from `src/index.ts` or `src/public.ts` instead of forcing consumers to reach into deep component paths.
- **Scope discipline**: Do not move route loaders, content parsing, or public-site-only layouts into this package unless multiple workspaces need the abstraction.
- **Utilities**: Shared helpers stay small and composable; `cn`-style class merging and other generic helpers belong in `src/lib`, not mixed into component files unless they are component-specific.
- **Control surfaces**: a control paints `not-in-[.site-panel]:bg-background` and restores its translucent fill with `in-[.site-panel]:`, because a tool surface has no panel behind it while the public site's panels do that separating. Two things silently defeat it:
  - Every `dark:` utility here is live — each app rendering this package forces `.dark` on the root — so a `dark:bg-*` left beside a new background class outranks it and the change is a no-op. Remove it in the same edit that adds the replacement.
  - `tailwind-merge` treats each modifier as its own conflict group, so a plain `bg-*` from a consumer displaces neither variant class and loses to both. An override has to supply **both** modified forms, not a bare one.

  Portalled content (dialog, popover, dropdown) renders at `document.body` and so has no `.site-panel` ancestor, whatever opened it — a control inside one takes the opaque branch even though the portal paints its own surface. `AlertDialogCancel` overrides for exactly this reason.

