# Web service

The public web site is a Vite SPA deployed from `apps/web/Dockerfile` through
`infra/docker/web-compose.yaml`.

The image is built by CI, not on the deploy host — see
[`docs/deployment.md`](../../docs/deployment.md).
