import { createCoverageConfig } from "@unimatrix/config-vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: createCoverageConfig({
      thresholds: { statements: 80, functions: 79 },
      // `circuit-field.tsx` is excluded because the field is switched off at
      // `CIRCUIT_FIELD_ENABLED` while it is unfinished: its canvas never
      // mounts, so the component-level suites are skipped and the file would
      // otherwise drag the whole package under its thresholds. Everything the
      // canvas is built from — routing, trace generation, occlusion, packets —
      // is covered by its own module's tests and stays gated. Remove this line
      // in the same commit that flips the flag.
      exclude: ["src/components/ui/**", "src/components/circuit-field.tsx"],
    }),
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
