import { nodeApiApp } from "@unimatrix/deploy-config";

export default nodeApiApp({
  appDir: "api",
  packageName: "@unimatrix/api",
  dockerfileEnv: [
    { name: "NODE_ENV", value: "production" },
    { name: "HOST", value: "0.0.0.0" },
    { name: "PORT", value: "3001" },
    { name: "LOG_LEVEL", value: "info" },
    {
      name: "DATABASE_URL",
      value: "/data/unimatrix.sqlite",
      comment: [
        "The SQLite database (user settings + files) lives under /data so it can be",
        "backed by a persistent volume — without one, all user data is lost on",
        "redeploy. Set DB_MIGRATE_ON_START=true (see api-compose.yaml) so pending",
        "migrations are applied against that volume at boot.",
      ],
    },
  ],
  composeEnv: [
    { name: "HOST", value: { kind: "literal", value: "0.0.0.0" } },
    { name: "PORT", value: { kind: "literal", value: "3001" } },
    { name: "NODE_ENV", value: { kind: "literal", value: "production" } },
    { name: "LOG_LEVEL", value: { kind: "literal", value: "info" } },
    { name: "TRUST_PROXY", value: { kind: "literal", value: '"1"' } },
    { name: "CORS_ALLOWED_ORIGINS", value: { kind: "variable", name: "CORS_ALLOWED_ORIGINS" } },
    {
      name: "CLERK_SECRET_KEY",
      value: { kind: "variable", name: "CLERK_SECRET_KEY" },
      comment: [
        "Required together in production — the API refuses to boot without all",
        "three (`parseClerkConfig` in apps/api/src/config.ts). Compose passes",
        "nothing to a container that is not named here, so setting them in the",
        "deployment platform is not enough on its own: leaving this block out is",
        "what put the production API in a restart loop, which reads from outside",
        "as every content route 404ing.",
      ],
    },
    { name: "CLERK_PUBLISHABLE_KEY", value: { kind: "variable", name: "CLERK_PUBLISHABLE_KEY" } },
    {
      name: "CLERK_JWT_KEY",
      value: { kind: "variable", name: "CLERK_JWT_KEY" },
      comment: [
        "A PEM public key. Clerk strips newlines before use, so a single-line",
        "value works and avoids a multi-line env value the platform may truncate.",
      ],
    },
    {
      name: "DB_MIGRATE_ON_START",
      value: { kind: "literal", value: '"true"' },
      comment: [
        "Apply pending Drizzle migrations against the mounted volume at startup",
        "(idempotent). The DB file defaults to /data/unimatrix.sqlite (set in the",
        "Dockerfile); the api-data volume below persists it across redeploys.",
      ],
    },
  ],
  volumes: [{ name: "api-data", mountPath: "/data" }],
});
