import { staticSpaApp } from "@unimatrix/deploy-config";

export default staticSpaApp({
  appDir: "admin",
  packageName: "@unimatrix/admin",
  buildArgs: [
    { name: "VITE_API_BASE_URL", default: "https://api.unimatrix-01.dev" },
    { name: "VITE_AUTH_APP_URL", default: "https://auth.unimatrix-01.dev" },
    {
      name: "VITE_CLERK_PUBLISHABLE_KEY",
      default: "pk_live_Y2xlcmsudW5pbWF0cml4LTAxLmRldiQ",
      comment: [
        "The Clerk publishable key is public (safe to ship in a browser bundle,",
        "and it already does): it base64-decodes to the Clerk frontend API",
        "hostname (clerk.unimatrix-01.dev), nothing secret. Defaulted here so a",
        "CI-built image is correct without out-of-band configuration; override",
        "with --build-arg for a different Clerk instance.",
      ],
    },
  ],
});
