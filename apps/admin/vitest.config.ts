import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { createCoverageConfig } from "@unimatrix/config-vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
      {
        find: /^@unimatrix\/api-client$/,
        replacement: fileURLToPath(
          new URL("../../packages/api-client/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@unimatrix\/auth\/react$/,
        replacement: fileURLToPath(new URL("../../packages/auth/src/react.tsx", import.meta.url)),
      },
      {
        find: /^@unimatrix\/auth$/,
        replacement: fileURLToPath(new URL("../../packages/auth/src/index.ts", import.meta.url)),
      },
      {
        find: /^@unimatrix\/chrome\/tool$/,
        replacement: fileURLToPath(new URL("../../packages/chrome/src/tool.ts", import.meta.url)),
      },
      {
        find: /^@unimatrix\/shared$/,
        replacement: fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      },
      {
        find: /^@unimatrix\/ui\/public$/,
        replacement: fileURLToPath(new URL("../../packages/ui/src/public.ts", import.meta.url)),
      },
      // Must sit before the bare `@unimatrix/ui` entry below — see the same
      // comment in `vite.config.ts`.
      {
        find: /^@unimatrix\/ui\/editor$/,
        replacement: fileURLToPath(new URL("../../packages/ui/src/editor.ts", import.meta.url)),
      },
      {
        find: /^@unimatrix\/ui$/,
        replacement: fileURLToPath(new URL("../../packages/ui/src/index.ts", import.meta.url)),
      },
      {
        find: /^react$/,
        replacement: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
      },
    ],
    dedupe: ["@tanstack/react-router", "react", "react-dom"],
  },
  test: {
    // This workspace's own floor, measured on this workspace rather than
    // copied from a sibling: `@unimatrix/config-vitest` owns the provider,
    // reporters and exclusions, and each workspace supplies its own numbers.
    //
    // Re-measured 2026-08-02 after the CMS landed: 64.18% statements / 67.2%
    // functions, rounded down. Raised from the pre-CMS 53/57 — the new
    // `src/features/content` code arrived well-tested and pulled the ratio up.
    // `src/main.tsx`, `src/routes/__root.tsx`, `createAppRouter`, and every
    // route's non-lazy file still sit at zero — they are bootstrap and route
    // registration, exercised by the browser and by nothing else here.
    coverage: createCoverageConfig({
      thresholds: { statements: 64, functions: 67 },
    }),
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
