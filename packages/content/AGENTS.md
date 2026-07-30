# AGENTS.md

## 1. Overview
`packages/content` is the typed content-system boundary for repo-backed authored content. It parses and validates the live public content domains without taking on UI rendering or transport concerns.

## 2. Core Behaviors & Patterns
- **Repo-backed loading**: `src/node.ts` reads markdown from `content/home`, `content/projects` and `content/blog` and returns typed documents. Only `content/home` reaches the site directly; the projects/blog loaders exist for `apps/api/scripts/seed-content.ts`. Keep loaders synchronous and filesystem-based unless the package boundary changes intentionally.
- **Typed parsing pipeline**: Parsers split frontmatter extraction, field validation, and document shaping. Required values are enforced through helpers such as `requireString`, `requireDateString`, and `requireBody`.
- **Scope boundary**: This package stays limited to the live public-site domains.

## 3. Conventions
- **Naming**: Use `parse*` for pure parsing helpers, `load*` for filesystem-backed loaders, and `require*` or `optional*` helpers for frontmatter field extraction.
- **Types**: Keep frontmatter and document types explicit and collection-specific rather than collapsing them into generic record types.
- **Structure**: Put collection-agnostic parsing helpers in `frontmatter.ts` and collection-specific shaping in `parsers.ts`; avoid mixing Node I/O into the pure parser files.

