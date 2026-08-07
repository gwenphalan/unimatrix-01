import { staticSpaApp } from "@unimatrix/deploy-config";

export default staticSpaApp({
  appDir: "admin",
  packageName: "@unimatrix/admin",
  buildArgs: [
    { name: "VITE_API_BASE_URL", default: "/api" },
    { name: "VITE_AUTH_APP_URL", default: "https://auth.unimatrix-01.dev" },
    {
      name: "VITE_CLERK_PUBLISHABLE_KEY",
      comment: [
        "The Clerk publishable key is public (safe to ship in a browser bundle),",
        "but it is still an ARG->ENV pair rather than a hardcoded default: Vite",
        "inlines `import.meta.env.VITE_*` values at build time, so this image",
        "must be built with the real key for the target Clerk instance, e.g.:",
        "  docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx ...",
        "It has no default on purpose — `loadAdminAppRuntimeConfig` throws without",
        "one, so an image built without it fails loudly in the browser rather than",
        "rendering an admin console that can never sign anyone in.",
      ],
      composeComment: [
        "Required — `loadAdminAppRuntimeConfig` throws without it, so an image",
        "built without the key fails loudly rather than rendering an admin",
        "console that can never sign anyone in. Inlined at build time, so pass",
        "it here (not runtime env).",
      ],
    },
  ],
});
