# @unimatrix/app-config

Zod-backed validation for the two external config boundaries every Vite app
has: the browser runtime env (`import.meta.env.VITE_*`) and the dev-proxy env
read by `vite.config.ts`.

## Shape

- **Field builders, not app loaders.** The validation rules are identical
  across apps while the shapes legitimately differ (web's Clerk key is
  optional, admin has an auth-hub URL, auth has neither). Each app composes
  its own schema in its `src/lib/config.ts` from `apiBaseUrl()`,
  `requiredEnvString()`, `optionalHttpUrl()` etc., and keeps its own explicit
  exported config interfaces. The one whole loader here is
  `loadDevProxyConfig` — the dev-proxy env has the same shape in every
  app, so there is nothing for an app to compose.
- **`zod` is this package's implementation detail.** Apps compose schemas via
  `envSchema(shape)` and never import `zod` themselves; no app gains a `zod`
  dependency by consuming this.
- **Error messages are a compatibility surface.** Every builder produces the
  exact message format the app-local validators used
  (`Invalid <app label> configuration: VITE_X ...`), and the apps' config
  tests assert those messages. Changing a message here is an app-visible
  change — the messages surface in browser consoles at boot.

## Resolution: source-only, and why that works from `vite.config.ts`

Source-only like `@unimatrix/chrome` and `@unimatrix/e2e-helpers`: `exports`
points at `src/index.ts`, consumers add a tsconfig `paths` entry and a vite
alias, no `dist` exists.

This package has one consumer surface the other source-only packages do not:
**`vite.config.ts` imports it in Node context** (for `loadDevProxyConfig`),
before any vite alias exists. That works because vite bundles the config file
with esbuild, which resolves the pnpm workspace symlink to the real path
outside `node_modules` and bundles the TypeScript directly — verified
empirically, not assumed.

**Plain Node resolves the `exports` map too, from any workspace that declares
the dependency.** Measured from `apps/web`: `node -e "import('@unimatrix/app-config')"`
returns every export. Type stripping is not engaged — pnpm links the package as
a symlink and Node resolves realpaths, so the file it strips is
`packages/app-config/src/index.ts`, outside `node_modules`. From a directory
with no dependency edge (`apps/api`, the repo root) it fails
`ERR_MODULE_NOT_FOUND`, because there is no symlink to follow. That is a
missing dependency, not a stripping refusal. So:

- Do not import this package from anything executed by plain `node` (scripts
  in `infra/scripts`, API code). Not because resolution fails — it would work
  once the dependency existed — but because it drags `zod` in, and the
  `infra/scripts` guards deliberately run before `pnpm install` with no
  `node_modules` at all. It is for Vite apps and their configs only.
- Do not "fix" the missing build script. A `dist` would be dead weight for
  every current consumer and would silently become load-bearing for exactly
  the consumers that must not exist.

## Boundaries

- Framework-agnostic and browser-safe: no React, no DOM types, no Node-only
  APIs. `zod` is the only dependency.
- No app names, no app-specific defaults beyond the cross-app constants
  (`DEFAULT_API_BASE_URL`, `DEFAULT_API_PROXY_TARGET`,
  `DEFAULT_AUTH_APP_URL`). The app label in error messages is an argument.
- Adding a new Vite app: give it a thin `src/lib/config.ts` composing these
  builders, a tsconfig `paths` entry, a vite alias, and a
  `workspace:*` dependency — see any of the three existing apps.
