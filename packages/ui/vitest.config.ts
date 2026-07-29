import { createCoverageConfig } from "@unimatrix/config-vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: createCoverageConfig({
      // Dropped from 80/79 when the circuit field was deleted. Those ~19
      // modules — routing, trace generation, occlusion, packets — carried their
      // own dense suites, so removing them took far more from the numerator
      // than the denominator. Nothing became less tested.
      //
      // What is left is dominated by `public-markdown.tsx`, which reads as
      // 1.98% here and is not actually untested: its behaviour, including the
      // `javascript:` link blocking, is asserted from `apps/web`
      // (`test/content-markdown.test.ts`, `test/content-markdown-rendering.test.tsx`).
      // Excluding it would hide a security-relevant file from the report
      // entirely, which is worse than recording a low number, so the number
      // stays and the thresholds sit just under the real figure — a regression
      // in `graph-background.tsx` or the markdown editor still trips this.
      thresholds: { statements: 54, functions: 52 },
      exclude: ["src/components/ui/**"],
    }),
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
