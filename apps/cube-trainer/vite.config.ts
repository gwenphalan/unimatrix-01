import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, type UserConfig } from "vite";

export function createCubeTrainerViteConfig(): UserConfig {
  return {
    plugins: [
      tanstackRouter({
        generatedRouteTree: "./src/routes/routeTree.gen.ts",
        routeFileIgnorePattern: "routeTree\\.gen\\.(ts|js)$",
        routesDirectory: "./src/routes",
        target: "react",
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: [
        {
          find: "@",
          replacement: fileURLToPath(new URL("./src", import.meta.url)),
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
      // `@tanstack/react-router` is deduped, not just React. `@unimatrix/chrome`
      // declares it as a peer and resolves from its own directory, so without
      // this the bundle can carry two copies and the shell's `useRouterState`
      // reads a router context the app's `RouterProvider` never wrote to.
      dedupe: ["@tanstack/react-router", "react", "react-dom"],
    },
  };
}

export default defineConfig(() => createCubeTrainerViteConfig());
