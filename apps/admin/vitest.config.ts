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
        find: /^@unimatrix\/ui\/public$/,
        replacement: fileURLToPath(new URL("../../packages/ui/src/public.ts", import.meta.url)),
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
    // Measured 2026-08-02 at 53.84% statements / 57.14% functions, rounded
    // down. `src/main.tsx`, `src/routes/__root.tsx`, `createAppRouter`, and
    // every route's non-lazy file sit at zero — they are bootstrap and route
    // registration, exercised by the browser and by nothing else here. That is
    // an honest measurement, not a gap papered over by excluding them: when
    // the CMS lands, the ratio moves and this number gets re-measured rather
    // than lowered.
    coverage: createCoverageConfig({
      thresholds: { statements: 53, functions: 57 },
    }),
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
