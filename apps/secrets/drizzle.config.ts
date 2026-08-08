import { defineConfig } from "drizzle-kit";

import { resolveSecretsDatabaseFilePath } from "./src/config";

export default defineConfig({
  breakpoints: true,
  dialect: "sqlite",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: resolveSecretsDatabaseFilePath(),
  },
});
