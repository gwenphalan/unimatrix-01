import { nodeApiApp } from "@unimatrix/deploy-config";

export default nodeApiApp({
  appDir: "secrets",
  packageName: "@unimatrix/secrets-app",
  dockerfileEnv: [
    { name: "NODE_ENV", value: "production" },
    { name: "HOST", value: "0.0.0.0" },
    { name: "PORT", value: "3001" },
    { name: "LOG_LEVEL", value: "info" },
    {
      name: "SECRETS_DATABASE_URL",
      value: "/data/secrets.sqlite",
      comment: [
        "Sealed secret versions, service tokens and the audit log live under",
        "/data so they survive a redeploy — without a durable volume this",
        "store loses everything it exists to keep. Set DB_MIGRATE_ON_START=true",
        "(see secrets-compose.yaml) so pending migrations are applied against",
        "that volume at boot.",
      ],
    },
  ],
  composeEnv: [
    { name: "HOST", value: { kind: "literal", value: "0.0.0.0" } },
    { name: "PORT", value: { kind: "literal", value: "3001" } },
    { name: "NODE_ENV", value: { kind: "literal", value: "production" } },
    { name: "LOG_LEVEL", value: { kind: "literal", value: "info" } },
    {
      name: "SECRETS_KEKS",
      value: { kind: "variable", name: "SECRETS_KEKS" },
      comment: [
        "`<version>:<base64key>[,<version>:<base64key>...]`. Compose passes",
        "nothing to a container that is not named here — the API's CLERK_*",
        "restart loop is the recorded precedent for what leaving this out",
        "looks like from outside: a service that never boots, with nothing",
        "saying why. This key sits below every value this service stores in",
        "the trust order, so it must never itself be stored in this store.",
      ],
    },
    {
      name: "DB_MIGRATE_ON_START",
      value: { kind: "literal", value: '"true"' },
      comment: [
        "Apply pending Drizzle migrations against the mounted volume at",
        "startup (idempotent). The DB file defaults to /data/secrets.sqlite",
        "(set in the Dockerfile); the secrets-data volume below persists it",
        "across redeploys.",
      ],
    },
  ],
  volumes: [{ name: "secrets-data", mountPath: "/data" }],
});
