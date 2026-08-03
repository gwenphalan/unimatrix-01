# Prototypes

**This directory is empty on `main`, and stays that way.**

Prototypes live on `lab/*` branches and are never merged. The
`No prototypes on main` check fails if the diff adds a file under
`lab/prototypes/`. It is advisory — not armed as a required status check — so it
reports rather than blocks.

That check is **repo hygiene, not a security control** — worth saying plainly,
because a rule that sounds like a security boundary gets trusted like one. The
lab is local-dev only: no Dockerfile, no compose file, no domain, no CI image
job, no route in any deployed app. A prototype reaching `main` costs clutter,
`pnpm check` time, and rot. It does not expose anything.

## Writing one

Drop a `.tsx` file here with a default export and it appears on the lab's index
page. Nested directories work: `admin/section-nav.tsx` is the prototype
`admin/section-nav`, and `admin/section-nav/index.tsx` is the same id.

**Two directory levels, no deeper.** Discovery finds a prototype at any depth,
but the stylesheet scans three levels and no more, so a deeper file loads and
renders with no Tailwind classes at all. Nothing fails — see the styling rule
below for why the scan cannot simply be made recursive.

```tsx
// lab/prototypes/admin/section-nav.tsx
import { createLabApiClient, labAdminSession } from "@/mocks";

export default function SectionNavPrototype() {
  return <div>…</div>;
}
```

Then `pnpm --filter @unimatrix/lab dev` and open the printed URL.

## Rules

- **A prototype gets the bare viewport.** The host renders your default export
  and draws nothing around it — no title bar, no footer, no back link, because
  the browser has one. Import the shell the sketch actually belongs in:
  `ToolShell` from `@unimatrix/chrome/tool` for a tool or admin surface,
  `@unimatrix/chrome/public` for a site one, neither if you are designing chrome
  itself. The harness supplies none of them because it cannot know which is
  right, and the two are different layouts — a public-site sketch wrapped in tool
  chrome is designed against the wrong furniture just as surely as one wrapped in
  none.
- **Data comes from `lab/src/mocks/` and nowhere else.** `@unimatrix/api-client`,
  `@unimatrix/user-data`, `@unimatrix/auth/react` and `@clerk/*` are lint errors
  in this workspace. The mocks need no Clerk keys, no running API and no
  database, and they cannot reach a deployed origin.
- **This directory is excluded from lint, typecheck and prettier.** A
  half-finished sketch is not a failing check. It is *not* excluded from the
  stylesheet's `@source` globs — Tailwind still emits the classes you write
  here, because a prototype with no styles is worse than useless. Those globs
  are enumerated one per directory level rather than written recursively, which
  is where the two-level cap above comes from: this directory is gitignored, and
  a recursive glob would skip it entirely. `lab/src/styles.css` carries the
  measurement.
- **Expect rot.** `lab/*` branches drift behind `packages/ui` and
  `packages/chrome`. That is correct for throwaway work: a stale prototype
  breaks in the browser, which is the only place it is ever used.

## What is enforced mechanically, and what is not

Worth stating precisely, because a rule that reads like a security boundary gets
trusted like one.

**Enforced by ESLint** — but only under `lab/src/`, which is the linted tree:
imports of `@unimatrix/api-client`, `@unimatrix/user-data`, `@unimatrix/auth/react`,
`@unimatrix/auth/server` and `@clerk/*` are banned by name.

**Not enforced under `lab/prototypes/`.** That directory is deliberately excluded
from lint, typecheck, Prettier and coverage, so nothing stops a prototype from
importing whatever it likes. There is no vite alias to those modules, so an
import would fail to resolve rather than silently reach a real transport — but
that is a consequence of the wiring, **convention, not a mechanism** aimed at
prototypes.

**What actually keeps this contained** is that the lab has no Dockerfile, no
compose entry, no CI `Images` row and no build script, plus the
`No prototypes on main` check keeping `lab/prototypes/` empty on the default
branch. Containment is structural; the lint rule is hygiene for the harness.
