/**
 * Typed deploy config for the five apps' Dockerfile/compose generator.
 *
 * A `deploy.config.ts` at each app root builds one {@link DeployAppConfig}
 * through {@link staticSpaApp} or {@link nodeApiApp}. `infra/scripts/generate-deploy-config.mjs`
 * reads it and writes `apps/<app>/Dockerfile` and `infra/docker/<app>-compose.yaml`;
 * `infra/scripts/validate-deploy-config.mjs` checks it. Base images are not part
 * of this config — the generator reads the committed `FROM` lines and re-emits
 * them verbatim, so a Dependabot digest bump never has to touch generated
 * output. `nginx.conf` is `COPY`d, never generated, and carries no entry here
 * either.
 */

/**
 * A `docker build --build-arg` a static SPA image accepts, inlined into the
 * browser bundle at build time via a paired `ARG`/`ENV` pair.
 */
export interface DeployBuildArg {
  /** The `ARG`/`ENV` name, e.g. `"VITE_API_BASE_URL"`. */
  readonly name: string;
  /**
   * The Dockerfile `ARG NAME=<default>`. Omit entirely when the build must
   * supply a value — an empty string here is rejected by
   * {@link validateAppConfig}, since it inlines an empty value into the
   * bundle exactly as silently as no default does, but reads as intentional.
   */
  readonly default?: string;
  /** Multi-line comment placed above the `ARG` line in the Dockerfile. */
  readonly comment?: readonly string[];
  /**
   * A *different* comment placed above this arg's line in the compose
   * file's `build.args:` block. Only admin's Clerk key carries one today.
   */
  readonly composeComment?: readonly string[];
}

export interface StaticSpaAppConfig {
  readonly kind: "static-spa";
  /** The app's directory under `apps/`, e.g. `"web"`. */
  readonly appDir: string;
  /** The workspace package name, e.g. `"@unimatrix/web"` — `apps/auth`
   *  builds `@unimatrix/auth-app`, so this is never derived from `appDir`. */
  readonly packageName: string;
  readonly buildArgs: readonly DeployBuildArg[];
}

/** A compose value: either a literal or a `${NAME}` / `${NAME:-default}` substitution. */
export type DeployComposeValue =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "variable"; readonly name: string; readonly default?: string };

/** One `ENV NAME=value` baked into the API runtime image as its own default. */
export interface NodeApiDockerfileEnvVar {
  readonly name: string;
  readonly value: string;
  readonly comment?: readonly string[];
}

/** One entry under the API compose service's `environment:` block. */
export interface NodeApiComposeEnvVar {
  readonly name: string;
  readonly value: DeployComposeValue;
  readonly comment?: readonly string[];
}

/** A named volume, mounted at a fixed path in the runtime container. */
export interface DeployVolume {
  readonly name: string;
  readonly mountPath: string;
}

export interface NodeApiAppConfig {
  readonly kind: "node-api";
  readonly appDir: string;
  readonly packageName: string;
  /** `ENV` lines in the Dockerfile's runtime stage — image-baked defaults. */
  readonly dockerfileEnv: readonly NodeApiDockerfileEnvVar[];
  /** The compose service's `environment:` block — deploy-time overrides. */
  readonly composeEnv: readonly NodeApiComposeEnvVar[];
  readonly volumes: readonly DeployVolume[];
}

export type DeployAppConfig = StaticSpaAppConfig | NodeApiAppConfig;

/**
 * The Dockerfile's own `FROM` lines for externally-published images, read
 * from the file already on disk rather than declared here. Keeping base
 * images Dockerfile-owned is what lets Dependabot's nginx digest bumps
 * (`.github/dependabot.yml`) land without ever touching this config or
 * turning the generator's drift check red.
 */
export interface DeployDockerfileFromLines {
  /** The literal line, e.g. `"FROM node:${NODE_VERSION}-alpine AS base"`. */
  readonly base: string;
  /** The final stage's `FROM` — nginx for a static SPA, node again for the API. */
  readonly runtime: string;
}

export function staticSpaApp(config: Omit<StaticSpaAppConfig, "kind">): StaticSpaAppConfig {
  return { kind: "static-spa", ...config };
}

/** One call site (`apps/api`) — see the package `AGENTS.md` before adding a second. */
export function nodeApiApp(config: Omit<NodeApiAppConfig, "kind">): NodeApiAppConfig {
  return { kind: "node-api", ...config };
}

function hasEmptyStringDefault(defaultValue: string | undefined): boolean {
  return defaultValue !== undefined && defaultValue.length === 0;
}

const EMPTY_DEFAULT_MESSAGE =
  "an empty-string default, which inlines an empty value exactly as silently as no default at " +
  "all. Omit default entirely if the value has no safe fallback.";

/**
 * Structural checks a `deploy.config.ts` can fail on its own, with no
 * Dockerfile or compose file to compare against. Everything else — pairing,
 * `build.dockerfile`/`build.context`, and the API env probe — is either true
 * by construction (the generator writes both files from this same config) or
 * lives in `infra/scripts/validate-deploy-config.mjs`, which can reach
 * `apps/api/src/config.ts` and the filesystem in ways this package must not.
 */
export function validateAppConfig(config: DeployAppConfig): readonly string[] {
  const failures: string[] = [];
  const label = config.appDir.length > 0 ? config.appDir : "(empty appDir)";

  if (config.appDir.length === 0) {
    failures.push("appDir must not be empty.");
  }
  if (!config.packageName.startsWith("@unimatrix/")) {
    failures.push(`${label}: packageName must start with "@unimatrix/".`);
  }

  if (config.kind === "static-spa") {
    const seen = new Set<string>();
    for (const arg of config.buildArgs) {
      if (arg.name.length === 0) {
        failures.push(`${label}: a buildArg has an empty name.`);
      } else if (seen.has(arg.name)) {
        failures.push(`${label}: buildArg ${arg.name} is declared more than once.`);
      }
      seen.add(arg.name);
      if (hasEmptyStringDefault(arg.default)) {
        failures.push(`${label}: buildArg ${arg.name} has ${EMPTY_DEFAULT_MESSAGE}`);
      }
    }
    return failures;
  }

  const seenDockerfileEnv = new Set<string>();
  for (const env of config.dockerfileEnv) {
    if (seenDockerfileEnv.has(env.name)) {
      failures.push(`${label}: dockerfileEnv ${env.name} is declared more than once.`);
    }
    seenDockerfileEnv.add(env.name);
  }

  const seenComposeEnv = new Set<string>();
  for (const env of config.composeEnv) {
    if (seenComposeEnv.has(env.name)) {
      failures.push(`${label}: composeEnv ${env.name} is declared more than once.`);
    }
    seenComposeEnv.add(env.name);
    if (env.value.kind === "variable" && hasEmptyStringDefault(env.value.default)) {
      failures.push(`${label}: composeEnv ${env.name} has ${EMPTY_DEFAULT_MESSAGE}`);
    }
  }

  for (const volume of config.volumes) {
    if (!volume.mountPath.startsWith("/")) {
      failures.push(`${label}: volume ${volume.name} has a mountPath that is not absolute.`);
    }
  }

  return failures;
}

/**
 * Formats a compose `${NAME}` / `${NAME:-default}` substitution. The one
 * place this spelling decision is made, used by both a static SPA's
 * `build.args:` and the API's `environment:` block — an arg or env var with
 * no Dockerfile/image default gets the bare form, everything else the
 * `:-default` form. Reversing this is a browser-console-only failure: an
 * explicit empty `--build-arg` overrides the Dockerfile's own `ARG` default,
 * so a bare reference plus an unset deploy-environment variable inlines an
 * empty string instead of falling back to it.
 */
function formatComposeVarReference(name: string, defaultValue: string | undefined): string {
  return defaultValue === undefined ? `\${${name}}` : `\${${name}:-${defaultValue}}`;
}

function formatComposeValue(value: DeployComposeValue): string {
  return value.kind === "literal"
    ? value.value
    : formatComposeVarReference(value.name, value.default);
}

function formatCommentLines(comment: readonly string[] | undefined): string[] {
  return comment === undefined
    ? []
    : comment.map((line) => (line.length === 0 ? "#" : `# ${line}`));
}

function regenerateNotice(config: DeployAppConfig): string[] {
  return [
    "# syntax=docker/dockerfile:1.7",
    `# GENERATED — edit apps/${config.appDir}/deploy.config.ts and run` +
      " `node ./infra/scripts/generate-deploy-config.mjs`, not this file.",
    "",
  ];
}

function staticSpaDockerfileBody(
  config: StaticSpaAppConfig,
  fromLines: DeployDockerfileFromLines,
): string[] {
  const lines: string[] = ["ARG NODE_VERSION=24.18.0", "", fromLines.base];
  lines.push(
    "ENV PNPM_HOME=/pnpm",
    "ENV PATH=${PNPM_HOME}:${PATH}",
    "WORKDIR /workspace",
    "RUN corepack enable",
    "",
    "FROM base AS build",
  );

  for (const arg of config.buildArgs) {
    lines.push(...formatCommentLines(arg.comment));
    lines.push(arg.default === undefined ? `ARG ${arg.name}` : `ARG ${arg.name}=${arg.default}`);
    lines.push(`ENV ${arg.name}=\${${arg.name}}`);
  }

  lines.push(
    "COPY . .",
    "RUN find . -name '*.tsbuildinfo' -delete && pnpm install --frozen-lockfile",
    `RUN pnpm --filter ${config.packageName} build`,
    "",
    fromLines.runtime,
    `COPY apps/${config.appDir}/nginx.conf /etc/nginx/conf.d/default.conf`,
    `COPY --from=build /workspace/apps/${config.appDir}/dist /usr/share/nginx/html`,
    "EXPOSE 8080",
    "HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1",
  );

  return lines;
}

function nodeApiDockerfileBody(
  config: NodeApiAppConfig,
  fromLines: DeployDockerfileFromLines,
): string[] {
  const lines: string[] = ["ARG NODE_VERSION=24.18.0", "", fromLines.base];
  lines.push(
    "ENV PNPM_HOME=/pnpm",
    "ENV PATH=${PNPM_HOME}:${PATH}",
    "WORKDIR /workspace",
    "RUN corepack enable",
    "",
    "FROM base AS build",
    "COPY . .",
    "RUN find . -name '*.tsbuildinfo' -delete && pnpm install --frozen-lockfile",
    "# Build the API together with its workspace dependencies (@unimatrix/shared,",
    "# @unimatrix/db, @unimatrix/auth) in topological order. apps/api compiles with",
    "# tsc and resolves these from their built dist (not source, unlike the Vite",
    '# apps), so they must be built first; the "..." selector keeps this correct as',
    "# the dependency set changes.",
    `RUN pnpm --filter "${config.packageName}..." build`,
    `RUN pnpm --filter ${config.packageName} --prod deploy --legacy /prod/api`,
    "",
    fromLines.runtime,
    "WORKDIR /app",
  );

  for (const env of config.dockerfileEnv) {
    lines.push(...formatCommentLines(env.comment));
    lines.push(`ENV ${env.name}=${env.value}`);
  }

  lines.push("COPY --from=build --chown=node:node /prod/api/ ./");

  // Every volume, not just the first: composeFor() mounts all of them, so a
  // second one here would mount root-owned and be unwritable by `node`.
  if (config.volumes.length > 0) {
    lines.push(
      "# Create each mount path owned by the non-root runtime user before the volumes",
      "# mount, so a fresh named volume inherits node ownership and stays writable.",
    );
    for (const volume of config.volumes) {
      lines.push(`RUN mkdir -p ${volume.mountPath} && chown node:node ${volume.mountPath}`);
    }
  }

  lines.push(
    "USER node",
    "EXPOSE 3001",
    "HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e " +
      "\"fetch('http://127.0.0.1:' + (process.env.PORT ?? '3001') + '/health').then((response) => " +
      '{ if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"',
    'CMD ["node", "dist/server.js"]',
  );

  return lines;
}

/**
 * Renders `apps/<app>/Dockerfile`. `fromLines` is read off the file already
 * on disk — see {@link DeployDockerfileFromLines} — and re-emitted verbatim,
 * never derived from `config`.
 */
export function dockerfileFor(
  config: DeployAppConfig,
  fromLines: DeployDockerfileFromLines,
): string {
  const body =
    config.kind === "static-spa"
      ? staticSpaDockerfileBody(config, fromLines)
      : nodeApiDockerfileBody(config, fromLines);

  return [...regenerateNotice(config), ...body].join("\n") + "\n";
}

/** Renders `infra/docker/<app>-compose.yaml`. */
export function composeFor(config: DeployAppConfig): string {
  const lines: string[] = [
    "services:",
    `  ${config.appDir}:`,
    "    build:",
    "      context: ../..",
    `      dockerfile: apps/${config.appDir}/Dockerfile`,
  ];

  if (config.kind === "static-spa" && config.buildArgs.length > 0) {
    lines.push("      args:");
    for (const arg of config.buildArgs) {
      lines.push(...formatCommentLines(arg.composeComment).map((line) => `        ${line}`));
      lines.push(`        ${arg.name}: ${formatComposeVarReference(arg.name, arg.default)}`);
    }
  }

  if (config.kind === "node-api") {
    lines.push("    environment:");
    for (const env of config.composeEnv) {
      lines.push(...formatCommentLines(env.comment).map((line) => `      ${line}`));
      lines.push(`      ${env.name}: ${formatComposeValue(env.value)}`);
    }

    if (config.volumes.length > 0) {
      lines.push("    volumes:");
      for (const volume of config.volumes) {
        lines.push(`      - ${volume.name}:${volume.mountPath}`);
      }
    }
  }

  lines.push("    restart: unless-stopped");

  if (config.kind === "node-api" && config.volumes.length > 0) {
    lines.push("", "volumes:");
    for (const volume of config.volumes) {
      lines.push(`  ${volume.name}:`);
    }
  }

  return lines.join("\n") + "\n";
}
