import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

import { createBoundariesConfig } from "./boundaries.mjs";
import { createRestrictedImportConfigs } from "./restricted-imports.mjs";

const sharedIgnores = ["**/dist/**", "**/coverage/**", "**/node_modules/**"];

function createTypedConfig({ globalsMap, tsconfigRootDir }) {
  const typedFiles = ["**/*.{ts,tsx,mts,cts}"];
  const typedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typedFiles,
  }));

  return tseslint.config(
    {
      ignores: sharedIgnores,
    },
    js.configs.recommended,
    ...typedConfigs,
    {
      files: typedFiles,
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: globalsMap,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          {
            prefer: "type-imports",
          },
        ],
        "@typescript-eslint/no-confusing-void-expression": "error",
      },
    },
    createBoundariesConfig({ tsconfigRootDir }),
    ...createRestrictedImportConfigs({ tsconfigRootDir }),
    // Must stay last: `eslint-config-prettier` only turns rules off, so any
    // config placed after it could re-enable a stylistic rule and put ESLint
    // back in conflict with Prettier. Prettier owns formatting; ESLint owns
    // correctness.
    prettier,
  );
}

export function createPackageConfig(options = {}) {
  return createTypedConfig({
    globalsMap: globals.node,
    tsconfigRootDir: options.tsconfigRootDir ?? process.cwd(),
  });
}

export function createAppConfig(options = {}) {
  return createTypedConfig({
    globalsMap: {
      ...globals.browser,
      ...globals.node,
    },
    tsconfigRootDir: options.tsconfigRootDir ?? process.cwd(),
  });
}
