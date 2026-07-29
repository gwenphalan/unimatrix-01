# Prototypes

**This directory is empty on `main`, and stays that way.**

Prototypes live on `lab/*` branches and are never merged. A required check on
pull requests to `main` fails if the diff touches `lab/prototypes/`, which is
what keeps this directory empty rather than branch-naming discipline.

That check is **repo hygiene, not a security control** — worth saying plainly,
because a rule that sounds like a security boundary gets trusted like one. The
lab is local-dev only: no Dockerfile, no compose file, no domain, no CI image
job, no route in any deployed app. A prototype reaching `main` costs clutter,
`pnpm check` time, and rot. It does not expose anything.

## Writing one

Drop a `.tsx` file here with a default export and it appears on the lab's index
page. Nested directories work: `admin/section-nav.tsx` is the prototype
`admin/section-nav`, and `admin/section-nav/index.tsx` is the same id.

```tsx
// lab/prototypes/admin/section-nav.tsx
import { createLabApiClient, labAdminSession } from "@/mocks";

export default function SectionNavPrototype() {
  return <div>…</div>;
}
```

Then `pnpm --filter @unimatrix/lab dev` and open the printed URL.

## Rules

- **Data comes from `lab/src/mocks/` and nowhere else.** `@unimatrix/api-client`,
  `@unimatrix/user-data`, `@unimatrix/auth/react` and `@clerk/*` are lint errors
  in this workspace. The mocks need no Clerk keys, no running API and no
  database, and they cannot reach a deployed origin.
- **This directory is excluded from lint, typecheck and prettier.** A
  half-finished sketch is not a failing check. It is *not* excluded from the
  stylesheet's `@source` globs — Tailwind still emits the classes you write
  here, because a prototype with no styles is worse than useless.
- **Expect rot.** `lab/*` branches drift behind `packages/ui` and
  `packages/chrome`. That is correct for throwaway work: a stale prototype
  breaks in the browser, which is the only place it is ever used.
