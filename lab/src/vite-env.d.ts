/// <reference types="vite/client" />

/**
 * No `ImportMetaEnv` declarations, and that is deliberate. The lab reads no
 * `VITE_*` variable — in particular there is no `VITE_API_BASE_URL`, because an
 * environment-configurable API origin is exactly the knob that would let a
 * prototype point at production. See `src/mocks/api-base-url.ts`.
 */
