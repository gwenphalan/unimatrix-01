import { nodeApiApp } from "@unimatrix/deploy-config";

export default nodeApiApp({
  appDir: "deploy",
  packageName: "@unimatrix/deploy-app",
  dockerfileEnv: [
    { name: "NODE_ENV", value: "production" },
    { name: "HOST", value: "0.0.0.0" },
    { name: "PORT", value: "3001" },
    { name: "LOG_LEVEL", value: "info" },
  ],
  composeEnv: [
    { name: "HOST", value: { kind: "literal", value: "0.0.0.0" } },
    { name: "PORT", value: { kind: "literal", value: "3001" } },
    { name: "NODE_ENV", value: { kind: "literal", value: "production" } },
    { name: "LOG_LEVEL", value: { kind: "literal", value: "info" } },
    {
      name: "DOKPLOY_BASE_URL",
      value: { kind: "variable", name: "DOKPLOY_BASE_URL" },
      comment: [
        "This service's own Compose stack, reachable over dokploy-network — see",
        "that network's comment below. No default: an unset variable reaches the",
        "container as an empty string rather than as absent, and this service's",
        "config loader refuses an empty value, so a stack deployed before this is",
        "set stops the service instead of booting it against nothing.",
      ],
    },
    {
      name: "DOKPLOY_API_KEY",
      value: { kind: "variable", name: "DOKPLOY_API_KEY" },
      comment: [
        "Unscoped and unexpiring — it can delete every application on the",
        "instance. It comes only from this variable, never lands on",
        "runtimeConfig, and never appears in a log line or an error message.",
        "See apps/deploy/AGENTS.md.",
      ],
    },
  ],
  volumes: [],
  networks: [
    {
      name: "dokploy-network",
      external: true,
      comment: [
        "This service exists to talk to Dokploy's own API, and the alternative —",
        "reaching https://dokploy.unimatrix-01.dev — costs two more Cloudflare",
        "Access service-token secrets and a round trip out through Cloudflare and",
        "back. The cost of joining: a container holding an instance-wide",
        "delete-everything token sits on the same network every app Traefik",
        "serves. Nothing routes *to* this service — no domain, no Traefik entry —",
        "so membership is reachability from it, not to it, and /health is the",
        "only route anything on that network could call. It is an attachable",
        "swarm overlay, which is what lets a plain Compose stack join it",
        "(measured on the host, 2026-08-12, recorded in apps/api/deploy.config.ts).",
      ],
    },
  ],
});
