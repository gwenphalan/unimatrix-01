/**
 * Hand-written rather than generated: `index.mjs` is plain JavaScript so it can
 * be loaded by `vitest.config.ts` without a build step, and every consuming
 * config is type-checked, so an untyped import would trip
 * `@typescript-eslint/no-unsafe-call` at each of the ten call sites.
 */

export interface CoverageThresholds {
  /** Minimum percentage of statements covered. */
  statements: number;
  /** Minimum percentage of functions covered. */
  functions: number;
}

export interface CreateCoverageConfigOptions {
  /** The workspace's current measured coverage, rounded down. */
  thresholds: CoverageThresholds;
  /** Extra globs to leave out, on top of the shared exclusions. */
  exclude?: string[];
}

export interface CoverageConfig {
  enabled: boolean;
  provider: "v8";
  include: string[];
  exclude: string[];
  reporter: string[];
  reportsDirectory: string;
  thresholds: CoverageThresholds;
}

export declare function createCoverageConfig(options: CreateCoverageConfigOptions): CoverageConfig;
