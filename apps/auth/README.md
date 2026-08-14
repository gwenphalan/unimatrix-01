# Auth service

The central Clerk-backed auth app is a Vite SPA deployed from
`apps/auth/Dockerfile` through `infra/docker/auth-compose.yaml`.

The image is built by CI, not on the deploy host — see
[`docs/deployment.md`](../../docs/deployment.md).
