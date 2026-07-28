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
        find: /^@unimatrix\/content$/,
        replacement: fileURLToPath(new URL("../../packages/content/src/index.ts", import.meta.url)),
      },
      {
        find: /^@unimatrix\/shared$/,
        replacement: fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
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
    dedupe: ["react", "react-dom"],
  },
  test: {
    coverage: createCoverageConfig({
      // Statements dropped one point when per-route `meta` descriptions were
      // added to the non-lazy route files: `head: () => ({ meta: [...] })` only
      // runs when the router renders a route, which the Playwright smoke suite
      // does and the vitest unit suite does not. The statements are real and
      // shipped, they are simply unreachable from this suite.
      //
      // Both dropped ~2 points again when `src/lib/use-media-query.ts` was
      // deleted (the circuit-field mobile gate moved into `@unimatrix/ui`).
      // That file was 13 statements and 7 functions of *fully covered* code —
      // every app-shell render exercised it — so removing it took more from
      // the numerator than the denominator. Nothing became less tested.
      thresholds: { statements: 56, functions: 51 },
    }),
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
