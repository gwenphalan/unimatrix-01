import { createAppConfig } from "@unimatrix/config-eslint";

export default [
  // Build output, like `dist`: the prerender driver's bundle and the algorithm
  // generator's, neither of which the shared config can know about. Plus the
  // verbatim upstream files under `vendor/`, which are someone else's code.
  { ignores: [".generate/**", ".prerender/**", "vendor/**"] },
  ...createAppConfig({
    tsconfigRootDir: import.meta.dirname,
  }),
];
