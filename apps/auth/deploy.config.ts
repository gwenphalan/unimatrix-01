import { staticSpaApp } from "@unimatrix/deploy-config";

export default staticSpaApp({
  appDir: "auth",
  packageName: "@unimatrix/auth-app",
  buildArgs: [
    { name: "VITE_API_BASE_URL", default: "/api" },
    {
      name: "VITE_CLERK_PUBLISHABLE_KEY",
      comment: [
        "The Clerk publishable key is public (safe to ship in a browser bundle),",
        "but it is still an ARG->ENV pair rather than a hardcoded default: Vite",
        "inlines `import.meta.env.VITE_*` values at build time, so this image",
        "must be built with the real key for the target Clerk instance, e.g.:",
        "  docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx ...",
      ],
    },
  ],
});
