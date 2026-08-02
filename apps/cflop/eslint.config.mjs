import { createAppConfig } from "@unimatrix/config-eslint";

export default [
  // Build output, like `dist`: the prerender driver's own bundle, which the
  // shared config cannot know about.
  { ignores: [".prerender/**"] },
  ...createAppConfig({
    tsconfigRootDir: import.meta.dirname,
  }),
];
