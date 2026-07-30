# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace
RUN corepack enable

FROM base AS build
COPY . .
RUN find . -name '*.tsbuildinfo' -delete && pnpm install --frozen-lockfile
RUN pnpm --filter @unimatrix/cflop build

FROM nginx:1.29-alpine AS runtime
COPY apps/cflop/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/cflop/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
