import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, loadEnv, type UserConfig } from "vite";

import { loadWebDevProxyConfig } from "./src/lib/config";

const webRootDir = fileURLToPath(new URL(".", import.meta.url));

export function createWebViteConfig(mode: string): UserConfig {
  const env = loadEnv(mode, webRootDir, "VITE_");
  const devProxyConfig = loadWebDevProxyConfig(env);

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
    build: {
      rolldownOptions: {
        output: {
          // Rolldown emits a separate chunk for every module shared by two or
          // more chunks. Mounting `AdminSlot` in the app shell and in six lazy
          // routes crossed that threshold for a handful of small modules and
          // shattered the eager set from 6 chunks into 11 — the same ~950 kB
          // of JavaScript, but nearly twice the requests on the critical path.
          // Measured cost: homepage Lighthouse performance 0.87 to 0.83, with
          // /blog and /projects also dropping under budget.
          //
          // Note the top-level `minSize`/`minShareCount` keys are only
          // fallbacks for `groups` entries — setting them alone does nothing,
          // which is worth knowing before reaching for them.
          codeSplitting: {
            groups: [
              {
                name: "app",
                // Workspace source only. Third-party chunking is left at the
                // default: a single vendor group also swallows dependencies
                // that only lazy routes need, which grew the eager set from
                // 954 kB to 992 kB and gave back most of what the smaller
                // request count won.
                //
                // A group claims every module its `test` matches regardless of
                // how that module is reached, so the admin feature and the
                // editor are excluded explicitly — matching them here would
                // pull them out of their dynamic-import chunks and onto the
                // public critical path, the exact regression `./editor` and
                // `admin-slot` exist to prevent.
                test: (id: string) => {
                  if (/[\\/]node_modules[\\/]/u.test(id)) return false;
                  if (/[\\/]src[\\/]features[\\/]admin[\\/]/u.test(id)) return false;
                  if (/[\\/]packages[\\/]ui[\\/]src[\\/]editor\.ts$/u.test(id)) return false;
                  if (/[\\/]components[\\/]markdown-editor[\\/]/u.test(id)) return false;

                  return /[\\/](apps[\\/]web|packages[\\/][a-z-]+)[\\/]src[\\/]/u.test(id);
                },
              },
            ],
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
          target: devProxyConfig.apiProxyTarget,
        },
      },
      watch: {
        // Vite's watcher ignores `node_modules` and `.git` and nothing else, so
        // a `vitest run` beside a running dev server rewrites the hundreds of
        // HTML files under `coverage/` and the page full-reloads once per file.
        // Measured: 63 reloads from one test run, each one cancelling whatever
        // requests were in flight — which reads as a request that hangs
        // forever rather than as a reload storm.
        ignored: ["**/coverage/**", "**/dist/**", "**/.turbo/**", "**/playwright-report/**"],
      },
    },
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
          replacement: fileURLToPath(
            new URL("../../packages/content/src/index.ts", import.meta.url),
          ),
        },
        {
          find: /^@unimatrix\/shared$/,
          replacement: fileURLToPath(
            new URL("../../packages/shared/src/index.ts", import.meta.url),
          ),
        },
        // Ordered before the bare `@unimatrix/ui` entry below: these are
        // prefix-anchored regexes evaluated in order, and the bare one would
        // otherwise never let a subpath through.
        {
          find: /^@unimatrix\/ui\/editor$/,
          replacement: fileURLToPath(new URL("../../packages/ui/src/editor.ts", import.meta.url)),
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
      dedupe: ["react", "react-dom"],
    },
  };
}

export default defineConfig(({ mode }) => createWebViteConfig(mode));
