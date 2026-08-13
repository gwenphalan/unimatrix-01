import { describe, expect, it } from "vitest";

import {
  composeFor,
  dockerfileFor,
  nodeApiApp,
  staticSpaApp,
  validateAppConfig,
} from "../src/index.js";

const FROM_LINES = {
  base: "FROM node:${NODE_VERSION}-alpine AS base",
  runtime: "FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:deadbeef AS runtime",
};

const API_FROM_LINES = {
  base: "FROM node:${NODE_VERSION}-alpine AS base",
  runtime: "FROM node:${NODE_VERSION}-alpine AS runtime",
};

describe("staticSpaApp / dockerfileFor / composeFor", () => {
  it("omits ARG/ENV entirely for an app with no build args", () => {
    const config = staticSpaApp({
      appDir: "cflop",
      packageName: "@unimatrix/cflop",
      buildArgs: [],
    });

    const dockerfile = dockerfileFor(config, FROM_LINES);
    expect(dockerfile).not.toContain("ARG VITE_");
    expect(dockerfile.startsWith("# syntax=docker/dockerfile:1.7\n")).toBe(true);
    // The GENERATED banner must be line 2, or BuildKit demotes the syntax
    // directive to a plain comment and silently falls back to the legacy
    // frontend — see the package AGENTS.md and the plan this implements.
    expect(dockerfile.split("\n")[1]?.startsWith("# GENERATED")).toBe(true);

    const compose = composeFor(config);
    expect(compose).not.toContain("args:");
    expect(compose).toContain("dockerfile: apps/cflop/Dockerfile");
  });

  it("pairs each ARG with its ENV, with a default that has no trailing empty ENV default", () => {
    const config = staticSpaApp({
      appDir: "web",
      packageName: "@unimatrix/web",
      buildArgs: [{ name: "VITE_API_BASE_URL", default: "/api" }],
    });

    const dockerfile = dockerfileFor(config, FROM_LINES);
    expect(dockerfile).toContain(
      "ARG VITE_API_BASE_URL=/api\nENV VITE_API_BASE_URL=${VITE_API_BASE_URL}",
    );
  });

  it("emits a comment above an ARG with no default, and no comment when none is given", () => {
    const config = staticSpaApp({
      appDir: "auth",
      packageName: "@unimatrix/auth-app",
      buildArgs: [
        { name: "VITE_API_BASE_URL", default: "/api" },
        { name: "VITE_CLERK_PUBLISHABLE_KEY", comment: ["The Clerk publishable key is public."] },
      ],
    });

    const dockerfile = dockerfileFor(config, FROM_LINES);
    expect(dockerfile).toContain(
      "# The Clerk publishable key is public.\nARG VITE_CLERK_PUBLISHABLE_KEY\n",
    );
    expect(dockerfile).toContain("RUN pnpm --filter @unimatrix/auth-app build");
  });

  it("emits ${NAME:-default} when a build arg declares a default, and bare ${NAME} otherwise (A2)", () => {
    const config = staticSpaApp({
      appDir: "auth",
      packageName: "@unimatrix/auth-app",
      buildArgs: [
        { name: "VITE_API_BASE_URL", default: "/api" },
        { name: "VITE_CLERK_PUBLISHABLE_KEY" },
      ],
    });

    const compose = composeFor(config);
    expect(compose).toContain("VITE_API_BASE_URL: ${VITE_API_BASE_URL:-/api}");
    expect(compose).toContain("VITE_CLERK_PUBLISHABLE_KEY: ${VITE_CLERK_PUBLISHABLE_KEY}");
    // The bug this guards: an unset deploy-time var plus a bare reference
    // inlines an empty string even though the Dockerfile has a default.
    expect(compose).not.toContain("VITE_API_BASE_URL: ${VITE_API_BASE_URL}\n");
  });

  it("places a composeComment above its arg in the compose file only, not the Dockerfile", () => {
    const config = staticSpaApp({
      appDir: "admin",
      packageName: "@unimatrix/admin",
      buildArgs: [
        {
          name: "VITE_CLERK_PUBLISHABLE_KEY",
          comment: ["Dockerfile-only comment."],
          composeComment: ["Compose-only comment."],
        },
      ],
    });

    const dockerfile = dockerfileFor(config, FROM_LINES);
    const compose = composeFor(config);

    expect(dockerfile).toContain("Dockerfile-only comment.");
    expect(dockerfile).not.toContain("Compose-only comment.");
    expect(compose).toContain("Compose-only comment.");
    expect(compose).not.toContain("Dockerfile-only comment.");
  });

  it("re-emits the given FROM lines verbatim rather than deriving them", () => {
    const config = staticSpaApp({ appDir: "web", packageName: "@unimatrix/web", buildArgs: [] });
    const dockerfile = dockerfileFor(config, FROM_LINES);

    expect(dockerfile).toContain(FROM_LINES.base);
    expect(dockerfile).toContain(FROM_LINES.runtime);
  });
});

describe("nodeApiApp / dockerfileFor / composeFor", () => {
  const config = nodeApiApp({
    appDir: "api",
    packageName: "@unimatrix/api",
    dockerfileEnv: [
      { name: "NODE_ENV", value: "production" },
      { name: "DATABASE_URL", value: "/data/unimatrix.sqlite", comment: ["Lives under /data."] },
    ],
    composeEnv: [
      { name: "HOST", value: { kind: "literal", value: "0.0.0.0" } },
      { name: "TRUST_PROXY", value: { kind: "literal", value: '"1"' } },
      { name: "CORS_ALLOWED_ORIGINS", value: { kind: "variable", name: "CORS_ALLOWED_ORIGINS" } },
      {
        name: "CLERK_SECRET_KEY",
        value: { kind: "variable", name: "CLERK_SECRET_KEY" },
        comment: ["Required together in production."],
      },
    ],
    volumes: [{ name: "api-data", mountPath: "/data" }],
  });

  it("emits the ENV lines and mkdir/chown target from config, not hardcoded", () => {
    const dockerfile = dockerfileFor(config, API_FROM_LINES);
    expect(dockerfile).toContain("ENV NODE_ENV=production");
    expect(dockerfile).toContain("# Lives under /data.\nENV DATABASE_URL=/data/unimatrix.sqlite");
    expect(dockerfile).toContain("RUN mkdir -p /data && chown node:node /data");
    expect(dockerfile).toContain('RUN pnpm --filter "@unimatrix/api..." build');
  });

  it("keeps comments inside environment: indented at least 6 spaces (A6)", () => {
    const compose = composeFor(config);
    const lines = compose.split("\n");
    const startIndex = lines.findIndex((line) => line === "    environment:");
    expect(startIndex).toBeGreaterThan(-1);

    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined || /^\s{0,4}\S/u.test(line)) break;
      if (line.trim().startsWith("#")) {
        const indent = line.length - line.trimStart().length;
        expect(indent).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("declares the named volume both on the service and at the top level", () => {
    const compose = composeFor(config);
    expect(compose).toContain("    volumes:\n      - api-data:/data");
    expect(compose).toMatch(/\nvolumes:\n {2}api-data:\n?$/u);
  });

  // The Dockerfile and the compose file are rendered separately from one
  // config, so a volume the compose file mounts but the Dockerfile never
  // chowns would mount root-owned and be unwritable by `node`.
  it("initializes every volume mount path, not just the first", () => {
    const twoVolumes = nodeApiApp({
      appDir: "api",
      packageName: "@unimatrix/api",
      dockerfileEnv: [],
      composeEnv: [],
      volumes: [
        { name: "api-data", mountPath: "/data" },
        { name: "api-uploads", mountPath: "/uploads" },
      ],
    });

    const dockerfile = dockerfileFor(twoVolumes, API_FROM_LINES);
    expect(dockerfile).toContain("RUN mkdir -p /data && chown node:node /data");
    expect(dockerfile).toContain("RUN mkdir -p /uploads && chown node:node /uploads");

    const compose = composeFor(twoVolumes);
    expect(compose).toContain("- api-data:/data");
    expect(compose).toContain("- api-uploads:/uploads");
  });

  it("probes http by default and https when the scheme says so", () => {
    expect(dockerfileFor(config, API_FROM_LINES)).toContain("fetch('http://127.0.0.1:'");

    const tlsConfig = nodeApiApp({
      appDir: "secrets",
      packageName: "@unimatrix/secrets-app",
      dockerfileEnv: [],
      composeEnv: [],
      volumes: [],
      healthcheckScheme: "https",
    });

    const dockerfile = dockerfileFor(tlsConfig, API_FROM_LINES);
    expect(dockerfile).toContain("require('node:https')");
    expect(dockerfile).toContain("rejectUnauthorized: false");
    expect(dockerfile).not.toContain("fetch('http://127.0.0.1:'");
  });

  it("defers the scheme to a variable when one is named", () => {
    const deferred = nodeApiApp({
      appDir: "secrets",
      packageName: "@unimatrix/secrets-app",
      dockerfileEnv: [],
      composeEnv: [],
      volumes: [],
      healthcheckScheme: { kind: "variable", name: "SECRETS_TLS_CERT_BASE64" },
    });

    expect(dockerfileFor(deferred, API_FROM_LINES)).toContain(
      "require(process.env.SECRETS_TLS_CERT_BASE64 ? 'node:https' : 'node:http')",
    );
  });

  it("rejects a healthcheck variable with an empty name", () => {
    expect(
      validateAppConfig(
        nodeApiApp({
          appDir: "secrets",
          packageName: "@unimatrix/secrets-app",
          dockerfileEnv: [],
          composeEnv: [],
          volumes: [],
          healthcheckScheme: { kind: "variable", name: "" },
        }),
      ),
    ).toEqual([
      "secrets: healthcheckScheme names an empty environment variable, so the probe " +
        "would always choose http and a TLS listener would never answer it.",
    ]);
  });

  it("declares each network on the service and as external at the top level", () => {
    const networked = nodeApiApp({
      appDir: "secrets",
      packageName: "@unimatrix/secrets-app",
      dockerfileEnv: [],
      composeEnv: [],
      volumes: [],
      networks: [
        { name: "unimatrix-secrets", external: true, aliases: ["secrets"], comment: ["Shared."] },
        { name: "dokploy-network", external: true },
      ],
    });

    const compose = composeFor(networked);
    expect(compose).toContain(
      "    networks:\n      # Shared.\n      unimatrix-secrets:\n        aliases:\n          - secrets\n      dokploy-network:\n",
    );
    expect(compose).toContain(
      "\nnetworks:\n  unimatrix-secrets:\n    external: true\n  dokploy-network:\n    external: true\n",
    );
  });

  it("emits no networks block at all when none are declared", () => {
    expect(composeFor(config)).not.toContain("networks:");
  });
});

describe("validateAppConfig", () => {
  it("passes a well-formed static SPA config", () => {
    const config = staticSpaApp({
      appDir: "web",
      packageName: "@unimatrix/web",
      buildArgs: [{ name: "VITE_API_BASE_URL", default: "/api" }],
    });
    expect(validateAppConfig(config)).toEqual([]);
  });

  it("rejects an empty-string build arg default", () => {
    const config = staticSpaApp({
      appDir: "web",
      packageName: "@unimatrix/web",
      buildArgs: [{ name: "VITE_API_BASE_URL", default: "" }],
    });
    const failures = validateAppConfig(config);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("empty-string default");
  });

  it("rejects a duplicate build arg name", () => {
    const config = staticSpaApp({
      appDir: "web",
      packageName: "@unimatrix/web",
      buildArgs: [{ name: "VITE_API_BASE_URL" }, { name: "VITE_API_BASE_URL" }],
    });
    expect(validateAppConfig(config).some((message) => message.includes("more than once"))).toBe(
      true,
    );
  });

  it("rejects a packageName that does not start with @unimatrix/", () => {
    const config = staticSpaApp({ appDir: "web", packageName: "web", buildArgs: [] });
    expect(validateAppConfig(config).some((message) => message.includes("@unimatrix/"))).toBe(true);
  });

  it("passes a well-formed node-api config", () => {
    const config = nodeApiApp({
      appDir: "api",
      packageName: "@unimatrix/api",
      dockerfileEnv: [],
      composeEnv: [{ name: "HOST", value: { kind: "literal", value: "0.0.0.0" } }],
      volumes: [{ name: "api-data", mountPath: "/data" }],
    });
    expect(validateAppConfig(config)).toEqual([]);
  });

  it("rejects an empty-string composeEnv variable default", () => {
    const config = nodeApiApp({
      appDir: "api",
      packageName: "@unimatrix/api",
      dockerfileEnv: [],
      composeEnv: [
        {
          name: "CORS_ALLOWED_ORIGINS",
          value: { kind: "variable", name: "CORS_ALLOWED_ORIGINS", default: "" },
        },
      ],
      volumes: [],
    });
    const failures = validateAppConfig(config);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("empty-string default");
  });

  it("rejects a volume mount path that is not absolute", () => {
    const config = nodeApiApp({
      appDir: "api",
      packageName: "@unimatrix/api",
      dockerfileEnv: [],
      composeEnv: [],
      volumes: [{ name: "api-data", mountPath: "data" }],
    });
    expect(validateAppConfig(config).some((message) => message.includes("not absolute"))).toBe(
      true,
    );
  });

  it("rejects a non-external network, a duplicate one, and an empty name", () => {
    const config = nodeApiApp({
      appDir: "api",
      packageName: "@unimatrix/api",
      dockerfileEnv: [],
      composeEnv: [],
      volumes: [],
      networks: [
        { name: "unimatrix-secrets", external: false },
        { name: "unimatrix-secrets", external: true },
        { name: "", external: true },
      ],
    });

    const failures = validateAppConfig(config);
    expect(failures.some((message) => message.includes("is not external"))).toBe(true);
    expect(failures.some((message) => message.includes("declared more than once"))).toBe(true);
    expect(failures.some((message) => message.includes("empty name"))).toBe(true);
  });

  it("rejects an empty appDir", () => {
    const config = staticSpaApp({ appDir: "", packageName: "@unimatrix/web", buildArgs: [] });
    expect(
      validateAppConfig(config).some((message) => message.includes("appDir must not be empty")),
    ).toBe(true);
  });
});
