// GENERATED — edit the relevant apps/<app>/deploy.config.ts and run
// `node ./infra/scripts/generate-deploy-config.mjs`, not this file.
//
// The desired-state manifest apps/deploy's reconcile report and apply diff against Dokploy.
import type { DeployDesiredState } from "@unimatrix/deploy-config";

export const DEPLOY_DESIRED_STATE: DeployDesiredState = [
  {
    appDir: "admin",
    packageName: "@unimatrix/admin",
    kind: "static-spa",
    composePath: "infra/docker/admin-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-admin",
    containerPort: 8080,
    env: [{ name: "IMAGE_TAG", required: true }],
  },
  {
    appDir: "api",
    packageName: "@unimatrix/api",
    kind: "node-api",
    composePath: "infra/docker/api-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-api",
    containerPort: 3001,
    env: [
      { name: "CLERK_JWT_KEY", required: true },
      { name: "CLERK_PUBLISHABLE_KEY", required: true },
      { name: "CLERK_SECRET_KEY", required: true },
      { name: "CORS_ALLOWED_ORIGINS", required: true },
      { name: "IMAGE_TAG", required: true },
      { name: "SECRETS_BASE_URL", required: true },
      { name: "SECRETS_INTEGRATIONS_MANAGE_TOKEN", required: true },
      { name: "SECRETS_PLATFORM_WRITE_TOKEN", required: true },
      { name: "SECRETS_SERVICE_TOKEN", required: true },
      { name: "SECRETS_TLS_CERT_BASE64", required: true },
    ],
  },
  {
    appDir: "auth",
    packageName: "@unimatrix/auth-app",
    kind: "static-spa",
    composePath: "infra/docker/auth-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-auth",
    containerPort: 8080,
    env: [{ name: "IMAGE_TAG", required: true }],
  },
  {
    appDir: "cflop",
    packageName: "@unimatrix/cflop",
    kind: "static-spa",
    composePath: "infra/docker/cflop-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-cflop",
    containerPort: 8080,
    env: [{ name: "IMAGE_TAG", required: true }],
  },
  {
    appDir: "deploy",
    packageName: "@unimatrix/deploy-app",
    kind: "node-api",
    composePath: "infra/docker/deploy-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-deploy",
    containerPort: 3001,
    env: [
      { name: "DOKPLOY_API_KEY", required: true },
      { name: "DOKPLOY_BASE_URL", required: true },
      { name: "IMAGE_TAG", required: true },
    ],
  },
  {
    appDir: "secrets",
    packageName: "@unimatrix/secrets-app",
    kind: "node-api",
    composePath: "infra/docker/secrets-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-secrets",
    containerPort: 3001,
    env: [
      { name: "IMAGE_TAG", required: true },
      { name: "SECRETS_KEKS", required: true },
      { name: "SECRETS_TLS_CERT_BASE64", required: true },
      { name: "SECRETS_TLS_KEY_BASE64", required: true },
    ],
  },
  {
    appDir: "web",
    packageName: "@unimatrix/web",
    kind: "static-spa",
    composePath: "infra/docker/web-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-web",
    containerPort: 8080,
    env: [{ name: "IMAGE_TAG", required: true }],
  },
];
