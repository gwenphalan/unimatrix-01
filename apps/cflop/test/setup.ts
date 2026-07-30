import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  // Here rather than per-test: a spy restored on the last line of its own test is only restored
  // when that test passes, so a failing assertion leaks the stub into everything after it and
  // turns one red test into a cascade. `restoreMocks` is not set in `vitest.config.ts`.
  vi.restoreAllMocks();
});
