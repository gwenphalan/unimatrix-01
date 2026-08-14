# Content workflow

This page defines the current public authored-content surface and the rules
for changing it. Use it when you add, edit, validate, or wire content into
the web app.

## Where content lives

`content/home/index.md` is compiled into the web bundle and feeds `/` and
`/about`. Blog and project entries live in the content database behind the API
and are fetched at runtime; `content/blog/*.md` and `content/projects/*.md`
remain only as seed input for
`pnpm --filter @unimatrix/api seed:content`.

## Public route surface

The current content collections map to the following public routes.

- `/` for the homepage and public orientation content
- `/about` for the remainder of `content/home/index.md`
- `/projects` and `/projects/:slug` for the project listing and detail routes
- `/blog` and `/blog/:slug` for the writing listing and detail routes

Unknown project and blog slugs intentionally fall into the app's not-found
experience instead of an unhandled content error.

## Authoring rules

Keep public authored content constrained to the current typed collection
model.

- `content/home/index.md` stays Git-backed; blog and project entries are
  created through the admin surface against the API.
- Match frontmatter to the typed collection contracts in `packages/content`.
- Expect invalid or missing fields to fail with file-specific validation
  errors.
- Keep a markdown body after the frontmatter block for every current content
  file.
- The public site renders authored content with safe GitHub-flavored
  markdown.
- Raw HTML and executable MDX remain out of scope.
- Keep the public v1 content set curated. Repo-internal docs, policy pages,
  and future content domains stay out of scope unless a later issue expands
  the boundary.

## Authoring checklist

The sequence differs by collection, because only one of them is still a file.

1. **Home** — edit `content/home/index.md`, match the frontmatter to the typed schema in
   `packages/content`, and run the validation commands below. It is compiled into the bundle, so it
   ships with the next build.
2. **A blog or project entry** — create it through the admin surface. It lands in the content
   database and is live without a deploy. Do not add a markdown file for it.
3. **A seed file** under `content/blog` or `content/projects` — match the same schema, then re-seed
   with `pnpm --filter @unimatrix/api seed:content`. Editing one changes nothing on the live site
   until that runs.

## Validation commands

Use the commands below to validate authored content and registry wiring.

```bash
pnpm --filter @unimatrix/content lint
pnpm --filter @unimatrix/content typecheck
pnpm --filter @unimatrix/content test
pnpm --filter @unimatrix/content build
pnpm --filter @unimatrix/web test
```

`apps/web/test/content-registry.test.ts` fails if blog or project markdown is
imported back into the web bundle alongside the database.

## Docs versus public content

This repo keeps repo-operating docs and public content separate on purpose.

- `docs/` contains repo-internal operating documentation for contributors
  and agents.
- `content/` contains the public authored content that the web app renders.

Do not create repo-operating documents under `content/docs`. That path is
reserved for future public-site content, not internal contributor guidance.
