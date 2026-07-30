# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace
RUN corepack enable

FROM base AS build
ARG VITE_API_BASE_URL=/api
ARG VITE_AUTH_APP_URL=https://auth.unimatrix-01.dev
# The Clerk publishable key is public (safe to ship in a browser bundle),
# but it is still an ARG->ENV pair rather than a hardcoded default: Vite
# inlines `import.meta.env.VITE_*` values at build time, so this image
# must be built with the real key for the target Clerk instance, e.g.:
#   docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx ...
# It has no default on purpose — `loadAdminAppRuntimeConfig` throws without
# one, so an image built without it fails loudly in the browser rather than
# rendering an admin console that can never sign anyone in.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_AUTH_APP_URL=${VITE_AUTH_APP_URL}
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
COPY . .
RUN find . -name '*.tsbuildinfo' -delete && pnpm install --frozen-lockfile
RUN pnpm --filter @unimatrix/admin build

FROM nginx:1.31-alpine AS runtime
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
