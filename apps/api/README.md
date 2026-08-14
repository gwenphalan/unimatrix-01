# API service

The API is a Fastify service deployed from `apps/api/Dockerfile` through
`infra/docker/api-compose.yaml`.

The image is built by CI, not on the deploy host — see
[`docs/deployment.md`](../../docs/deployment.md).
