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

Use this sequence when you add a new public content file.

1. Create the markdown file under the correct live collection.
2. Match the frontmatter to the current typed schema in `packages/content`.
3. Run the relevant content and web validation commands.

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
