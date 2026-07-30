# AGENTS.md

## 1. Overview
`apps/admin` (package `@unimatrix/admin`) is the Vite + React + TanStack Router SPA that serves the administration console at `admin.unimatrix-01.dev`. Today it is a scaffold: one placeholder route on the shared tool shell. It is the origin the CMS moves onto (out of `apps/web`), and the home for future operator surfaces that have no relationship to the public site's route tree.

It is a **tool** surface, not a content surface. The site header/nav-tabs/footer combo is for content; this app gets `@unimatrix/chrome`'s `./tool` shell — title bar, dense content region, a way back to the public site, no site nav, no site footer.

## 2. Folder Structure
- `src/app`: `app-shell.tsx` (the `ToolShell` composition) and `router.tsx` (`createAppRouter`). There is deliberately **no** module-level `router` singleton and no query provider — see Core Behaviors.
- `src/features/auth`: `account-control.tsx` — the `UserButton`/sign-in-link pair handed to the shell as its `accountControl` slot.
- `src/lib/config.ts`: runtime env validation. Requires `VITE_CLERK_PUBLISHABLE_KEY`; `VITE_API_BASE_URL` defaults to `/api`; `VITE_AUTH_APP_URL` defaults to `https://auth.unimatrix-01.dev` and must be an absolute http(s) URL; dev-only `VITE_API_TARGET` defaults to `http://127.0.0.1:3001` and is read by `vite.config.ts` to proxy `/api`. Also exports `buildSignInHref`.
- `src/routes`: file-based routes with paired `*.tsx` (route data) and `*.lazy.tsx` (components). One route today: `index`. `routeTree.gen.ts` is generated — never hand-edit it.
- `src/styles.css`: `@unimatrix/ui/styles.css` plus the three `@source` lines. Do not remove them (see Core Behaviors).
- `test`: Vitest, unit only. No Playwright smoke suite — the surface is Clerk-gated and a smoke run would need live keys, exactly as for `apps/auth`. CI installs Chromium for `web` and `cflop` only; leave it that way.

## 3. Core Behaviors & Patterns
- **The placeholder route is ungated on purpose.** `canAccessAdminSection` from `@unimatrix/auth` is the predicate every admin section will read, but nothing here has anything to guard yet, and a gate around an empty page is a control that looks present and is not. The gate lands with the first real section. The origin's actual protection is Cloudflare Access on the proxied hostname, which is deployment config rather than app code — `curl https://admin.unimatrix-01.dev/` returns a 302 to `unimatrix-01.cloudflareaccess.com`. Access applies only to proxied traffic, so a record flipped back to DNS-only removes that protection silently.
- **Runtime config travels through the router context, not a module singleton.** `loadAdminAppRuntimeConfig` throws on a missing Clerk key, so a module-level `router` would move that throw to import time and take down anything that merely imports it, tests included. `main.tsx` is the only file that reads `import.meta.env`.
- **The three `@source` lines in `src/styles.css` are load-bearing.** Tailwind v4's source detection stops at the workspace boundary. Delete the `packages/chrome` line and the tool shell's utilities are never emitted: lint, tsc, unit tests and the production build all stay green while the layout collapses in a browser. `infra/scripts/check-app-wiring.sh` is the mechanical guard.
- **`@tanstack/react-router` stays in `resolve.dedupe`** in both `vite.config.ts` and `vitest.config.ts`. `@unimatrix/chrome` declares it as a peer and resolves from its own directory; two copies means the shell's `useRouterState` reads a router context `RouterProvider` never wrote to. `infra/scripts/check-app-wiring.sh` guards the **`vite.config.ts`** one only — it never opens `vitest.config.ts`, so that copy is on you.
- **No `@tanstack/react-query`.** Nothing fetches yet; adding it now would be a dependency with no consumer.
- **`nginx.conf` carries a tighter CSP than the other SPAs** because this app renders no user-authored markdown. `default-src`/`script-src`/`connect-src` are deliberately absent — Clerk's frontend-API host is a build-time value a static conf cannot name. Read the comment in the file before touching it.

## 4. Conventions
- **Route files**: TanStack Router file naming with paired `*.tsx` + `*.lazy.tsx`, matching `apps/web` and `apps/auth`; route data in the non-lazy file, UI in the lazy file.
- **Imports**: external first, then `@/` aliases, then relative. Prefer `@unimatrix/ui/public`.
- **Naming**: `PascalCase` components; `camelCase` helpers exported from kebab-case files.
- **Not part of `pnpm dev`** — run it with `pnpm --filter @unimatrix/admin dev`, port 5176 (preview 4176).
- **Coverage thresholds are this workspace's own**, in `vitest.config.ts`. Raise them by writing tests; never by editing the number down.

