/**
 * Typed deploy config for the apps' Dockerfile/compose generator.
 *
 * A `deploy.config.ts` at each app root builds one {@link DeployAppConfig}
 * through {@link staticSpaApp} or {@link nodeApiApp}. `infra/scripts/generate-deploy-config.mjs`
 * reads it and writes `apps/<app>/Dockerfile` and `infra/docker/<app>-compose.yaml`;
 * `infra/scripts/validate-deploy-config.mjs` checks it.
 *
 * The two outputs sit on opposite sides of the registry: the Dockerfile is what
 * CI builds and pushes, and the compose file only ever names the published
 * result — `image:`, never `build:` — so `appDir` is the image name as well as
 * the directory. Base images are not part of this config either; the generator
 * reads the committed `FROM` lines and re-emits them verbatim, so a Dependabot
 * digest bump never has to touch generated output. `nginx.conf` is `COPY`d,
 * never generated, and carries no entry here. The build stage installs from a
 * `turbo prune --docker` output rather than the whole repo, so a change to an
 * unrelated app's source cannot bust the install layer.
 */

/** The turbo version installed in the prune stage, pinned independently of
 *  the root `turbo` devDependency — see the package `AGENTS.md` §2. */
const TURBO_VERSION = "2.10.7";

/** Registry prefix of the published images the compose files pull. This plus an
 *  app's `appDir` must spell the same reference CI's `Publish` job pushes
 *  (`.github/workflows/ci.yml`), which hardcodes it twice;
 *  `infra/scripts/check-app-wiring.sh` is what stops the two drifting apart. */
const IMAGE_REGISTRY_PREFIX = "ghcr.io/unimatrixcore/unimatrix-";

/** The compose variable naming which published tag to deploy, set per
 *  environment in the deployment platform. Left unset it resolves to an empty
 *  string, which `docker compose config` accepts with a warning and
 *  `docker compose pull` then rejects as `invalid reference format` (measured)
 *  — so a missing tag stops the deploy rather than choosing a version. */
const IMAGE_TAG_VARIABLE = "IMAGE_TAG";

/** The container port nginx listens on inside every `static-spa` runtime image. */
const STATIC_SPA_CONTAINER_PORT = 8080;

/** The container port a `node-api` runtime image listens on unless `PORT` overrides it. */
const NODE_API_CONTAINER_PORT = 3001;

/**
 * A `docker build --build-arg` a static SPA image accepts, inlined into the
 * browser bundle at build time via a paired `ARG`/`ENV` pair.
 */
export interface DeployBuildArg {
  /** The `ARG`/`ENV` name, e.g. `"VITE_API_BASE_URL"`. */
  readonly name: string;
  /**
   * The Dockerfile `ARG NAME=<default>`, and the value that actually reaches
   * the browser bundle: the image is built once in CI with no `--build-arg`
   * and the compose file only pulls the published result, so nothing supplies
   * one later. {@link validateAppConfig} rejects a missing default as well as
   * an empty string — either inlines an empty value with every check staying
   * green. Optional only so the generator can still render the bare
   * `ARG NAME` form for a config that has not been fixed yet.
   */
  readonly default?: string;
  /** Multi-line comment placed above the `ARG` line in the Dockerfile. */
  readonly comment?: readonly string[];
}

export interface StaticSpaAppConfig {
  readonly kind: "static-spa";
  /** The app's directory under `apps/`, e.g. `"web"`. */
  readonly appDir: string;
  /** The workspace package name, e.g. `"@unimatrix/web"` — `apps/auth`
   *  builds `@unimatrix/auth-app`, so this is never derived from `appDir`. */
  readonly packageName: string;
  readonly buildArgs: readonly DeployBuildArg[];
  /**
   * Repo-root-relative paths `COPY`d into the build stage on top of the
   * pruned workspace, e.g. `"content/home"`. `turbo prune` emits workspace
   * packages only, so an app that imports something outside every workspace
   * — `apps/web` reads `content/home/index.md` straight off disk — cannot
   * build without it named here.
   */
  readonly extraBuildPaths?: readonly string[];
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

/**
 * A Docker network the compose service joins. Naming any network at all
 * replaces the implicit `default` one, so a config that declares these must
 * list every network the service needs — including the one Dokploy would
 * otherwise attach for Traefik.
 */
export interface DeployNetwork {
  readonly name: string;
  /**
   * Always `true` in practice, and {@link validateAppConfig} rejects `false`:
   * a non-external network of the same name is created per Compose project,
   * so two stacks naming it would each get a private copy, boot cleanly, and
   * never reach each other. Declared rather than assumed so the compose file
   * says which pre-existing network it expects.
   */
  readonly external: boolean;
  /** Extra DNS names this service answers to on that network. */
  readonly aliases?: readonly string[];
  /** Multi-line comment placed above this network's per-service entry. */
  readonly comment?: readonly string[];
}

/**
 * Which scheme the runtime container's own `HEALTHCHECK` probes. Defaults to
 * `"http"`. The variable form defers the choice to container start: `https`
 * when the named environment variable holds a non-empty value, `http`
 * otherwise — for a service whose TLS is configured rather than compiled in.
 */
export type DeployHealthcheckScheme =
  "http" | "https" | { readonly kind: "variable"; readonly name: string };

export interface NodeApiAppConfig {
  readonly kind: "node-api";
  readonly appDir: string;
  readonly packageName: string;
  /** `ENV` lines in the Dockerfile's runtime stage — image-baked defaults. */
  readonly dockerfileEnv: readonly NodeApiDockerfileEnvVar[];
  /** The compose service's `environment:` block — deploy-time overrides. */
  readonly composeEnv: readonly NodeApiComposeEnvVar[];
  readonly volumes: readonly DeployVolume[];
  /** Omitted means the implicit compose `default` network and nothing else. */
  readonly networks?: readonly DeployNetwork[];
  /**
   * Must follow the scheme the service actually listens with: the probe runs
   * inside the container, so an `http://` probe against a TLS listener never
   * succeeds and the container is marked unhealthy for its whole life — which
   * on Dokploy reads as a deploy that never comes up while the service serves
   * traffic fine.
   */
  readonly healthcheckScheme?: DeployHealthcheckScheme;
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

/** One call site per `node-api` app (every `deploy.config.ts` calling this) — see the package `AGENTS.md` §4. */
export function nodeApiApp(config: Omit<NodeApiAppConfig, "kind">): NodeApiAppConfig {
  return { kind: "node-api", ...config };
}

function hasEmptyStringDefault(defaultValue: string | undefined): boolean {
  return defaultValue !== undefined && defaultValue.length === 0;
}

const EMPTY_DEFAULT_MESSAGE =
  "an empty-string default, which inlines an empty value exactly as silently as no default at " +
  "all. Omit default entirely if the value has no safe fallback.";

/** What a `static-spa` build arg with nothing usable in `default` costs. */
const BUILD_ARG_CONSEQUENCE =
  "which inlines an empty value into the browser bundle. Nothing supplies one downstream: CI " +
  "builds the image with no --build-arg, and the compose file only pulls the published result.";

/**
 * A legal Docker image name component. `appDir` is the image name, so an
 * `appDir` outside this produces a reference no registry can resolve.
 */
const IMAGE_NAME_COMPONENT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

/**
 * Structural checks a `deploy.config.ts` can fail on its own, with no
 * Dockerfile or compose file to compare against. Everything else — pairing,
 * the `appDir`-to-directory match, and the API env probe — is either true
 * by construction (the generator writes both files from this same config) or
 * lives in `infra/scripts/validate-deploy-config.mjs`, which can reach
 * `apps/api/src/config.ts` and the filesystem in ways this package must not.
 */
export function validateAppConfig(config: DeployAppConfig): readonly string[] {
  const failures: string[] = [];
  const label = config.appDir.length > 0 ? config.appDir : "(empty appDir)";

  if (config.appDir.length === 0) {
    failures.push("appDir must not be empty.");
  } else if (!IMAGE_NAME_COMPONENT.test(config.appDir)) {
    failures.push(
      `${label}: appDir is not a legal Docker image name component, so the compose file would ` +
        `name ${IMAGE_REGISTRY_PREFIX}${config.appDir}:` +
        `${formatComposeVarReference(IMAGE_TAG_VARIABLE, undefined)} — a reference no registry ` +
        `can resolve.`,
    );
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
      if (arg.default === undefined) {
        failures.push(`${label}: buildArg ${arg.name} has no default, ${BUILD_ARG_CONSEQUENCE}`);
      } else if (hasEmptyStringDefault(arg.default)) {
        failures.push(
          `${label}: buildArg ${arg.name} has an empty-string default, ${BUILD_ARG_CONSEQUENCE}`,
        );
      }
    }

    for (const path of config.extraBuildPaths ?? []) {
      if (path.length === 0) {
        failures.push(`${label}: an extraBuildPaths entry is empty.`);
      } else if (path.startsWith("/")) {
        failures.push(
          `${label}: extraBuildPaths entry "${path}" is absolute; it must be repo-root-relative.`,
        );
      } else if (path.split("/").includes("..")) {
        failures.push(
          `${label}: extraBuildPaths entry "${path}" has a ".." segment, which would escape the build context.`,
        );
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

  const seenNetworks = new Set<string>();
  for (const network of config.networks ?? []) {
    if (network.name.length === 0) {
      failures.push(`${label}: a network has an empty name.`);
    } else if (seenNetworks.has(network.name)) {
      failures.push(`${label}: network ${network.name} is declared more than once.`);
    }
    seenNetworks.add(network.name);

    if (!network.external) {
      failures.push(
        `${label}: network ${network.name} is not external. Compose would create a separate ` +
          `network of that name per project, so each stack naming it would get a private copy, ` +
          `boot cleanly, and never reach the other.`,
      );
    }
  }

  const scheme = config.healthcheckScheme;

  if (typeof scheme === "object" && scheme.name.length === 0) {
    failures.push(
      `${label}: healthcheckScheme names an empty environment variable, so the probe would always ` +
        `choose http and a TLS listener would never answer it.`,
    );
  }

  return failures;
}

/**
 * Formats a compose `${NAME}` / `${NAME:-default}` substitution — the one
 * place that spelling is decided, shared by the service's `image:` tag and the
 * API's `environment:` block.
 *
 * The bare form is the one to reach for. An unset variable reaches the
 * container as an empty string rather than as absent, and both `node-api`
 * config loaders refuse an empty value, so a deployment variable nobody set
 * stops the service instead of booting it on a fallback nobody chose. The
 * `:-default` form is for a literal that is genuinely safe everywhere this
 * compose file runs.
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

/**
 * The `base` and `prune` stages, identical in shape for a static SPA and a
 * node service: `turbo prune <package> --docker` is what narrows the install
 * that follows to the packages `<package>` actually depends on, instead of
 * `pnpm install --frozen-lockfile` reinstalling the whole workspace on every
 * app's build regardless of which app changed.
 */
function baseAndPruneStageLines(
  packageName: string,
  fromLines: DeployDockerfileFromLines,
): string[] {
  return [
    "ARG NODE_VERSION=24.18.0",
    "",
    fromLines.base,
    "ENV PNPM_HOME=/pnpm",
    "ENV PATH=${PNPM_HOME}:${PATH}",
    "WORKDIR /workspace",
    "RUN corepack enable",
    "",
    "FROM base AS prune",
    // `npm`, not `pnpm add -g`: no package.json exists this early for corepack
    // to read a pinned pnpm version from, and `PNPM_HOME` is not a directory
    // `pnpm add -g` can install into. `npm` ships in the node base image.
    `ARG TURBO_VERSION=${TURBO_VERSION}`,
    // The `$TURBO_VERSION` below is Docker expanding the ARG above at build
    // time, unbraced so it cannot be misread as the identically named constant
    // this module interpolates on the line before.
    "RUN npm install -g turbo@$TURBO_VERSION",
    "COPY . .",
    `RUN turbo prune ${packageName} --docker`,
  ];
}

function staticSpaDockerfileBody(
  config: StaticSpaAppConfig,
  fromLines: DeployDockerfileFromLines,
): string[] {
  const lines: string[] = baseAndPruneStageLines(config.packageName, fromLines);
  lines.push(
    "",
    "FROM base AS build",
    "COPY --from=prune /workspace/out/json/ .",
    "RUN pnpm install --frozen-lockfile",
  );

  for (const arg of config.buildArgs) {
    lines.push(...formatCommentLines(arg.comment));
    lines.push(arg.default === undefined ? `ARG ${arg.name}` : `ARG ${arg.name}=${arg.default}`);
    lines.push(`ENV ${arg.name}=\${${arg.name}}`);
  }

  lines.push("COPY --from=prune /workspace/out/full/ .");
  for (const path of config.extraBuildPaths ?? []) {
    lines.push(`COPY ${path} ./${path}`);
  }

  lines.push(
    `RUN pnpm --filter ${config.packageName} build`,
    "",
    fromLines.runtime,
    `COPY apps/${config.appDir}/nginx.conf /etc/nginx/conf.d/default.conf`,
    `COPY --from=build /workspace/apps/${config.appDir}/dist /usr/share/nginx/html`,
    `EXPOSE ${STATIC_SPA_CONTAINER_PORT}`,
    `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:${STATIC_SPA_CONTAINER_PORT}/ || exit 1`,
  );

  return lines;
}

/**
 * The `https` probe skips certificate verification, and that is correct only
 * because it is a loopback liveness check inside the very container the
 * certificate belongs to: there is no third party on that connection to
 * authenticate, and the service's certificate is issued for its Compose
 * service name rather than `127.0.0.1`, so verification would fail on the
 * hostname alone. It uses `node:https` rather than `fetch`, which cannot be
 * told to skip verification without an undici dispatcher the runtime image is
 * not guaranteed to carry.
 *
 * The variable form picks the module at container start rather than at image
 * build, because whether the service serves TLS is a runtime decision: the
 * same image serves plain HTTP when its certificate variables are unset. A
 * build-time choice is wrong in one direction or the other, and both are the
 * same failure — a container marked unhealthy for its whole life while it
 * serves traffic fine, which on Dokploy reads as a deploy that never comes up.
 */
function nodeApiHealthcheckLine(scheme: DeployHealthcheckScheme): string {
  const prefix =
    "HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e ";

  if (scheme === "http") {
    return (
      prefix +
      `"fetch('http://127.0.0.1:' + (process.env.PORT ?? '${NODE_API_CONTAINER_PORT}') + '/health').then((response) => ` +
      '{ if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"'
    );
  }

  // `rejectUnauthorized` is inert on `node:http`, so one request body serves
  // both modules and only the `require` differs.
  const module =
    scheme === "https" ? "'node:https'" : `process.env.${scheme.name} ? 'node:https' : 'node:http'`;

  return (
    prefix +
    `"require(${module}).get({ host: '127.0.0.1', port: process.env.PORT ?? '${NODE_API_CONTAINER_PORT}', ` +
    "path: '/health', rejectUnauthorized: false }, (response) => { process.exit(" +
    "response.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))\""
  );
}

function nodeApiDockerfileBody(
  config: NodeApiAppConfig,
  fromLines: DeployDockerfileFromLines,
): string[] {
  const lines: string[] = baseAndPruneStageLines(config.packageName, fromLines);
  lines.push(
    "",
    "FROM base AS build",
    "COPY --from=prune /workspace/out/json/ .",
    "RUN pnpm install --frozen-lockfile",
    "COPY --from=prune /workspace/out/full/ .",
    "# Build this service together with its workspace dependencies, in",
    "# topological order. It compiles with tsc and resolves them from their",
    "# built dist (not source, unlike the Vite apps), so they must be built",
    '# first; the "..." selector keeps this correct as the dependency set changes.',
    `RUN pnpm --filter "${config.packageName}..." build`,
    `RUN pnpm --filter ${config.packageName} --prod deploy --legacy /prod/app`,
    "",
    fromLines.runtime,
    "WORKDIR /app",
  );

  for (const env of config.dockerfileEnv) {
    lines.push(...formatCommentLines(env.comment));
    lines.push(`ENV ${env.name}=${env.value}`);
  }

  lines.push("COPY --from=build --chown=node:node /prod/app/ ./");

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
    `EXPOSE ${NODE_API_CONTAINER_PORT}`,
    nodeApiHealthcheckLine(config.healthcheckScheme ?? "http"),
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
    `    image: ${IMAGE_REGISTRY_PREFIX}${config.appDir}:` +
      formatComposeVarReference(IMAGE_TAG_VARIABLE, undefined),
  ];

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

    const networks = config.networks ?? [];

    if (networks.length > 0) {
      // Mapping form throughout, even with no aliases: compose rejects a
      // service that mixes the list and mapping forms, so one network gaining
      // an alias would otherwise have to rewrite its siblings.
      lines.push("    networks:");
      for (const network of networks) {
        lines.push(...formatCommentLines(network.comment).map((line) => `      ${line}`));
        lines.push(`      ${network.name}:`);
        const aliases = network.aliases ?? [];
        if (aliases.length > 0) {
          lines.push("        aliases:");
          for (const alias of aliases) {
            lines.push(`          - ${alias}`);
          }
        }
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

  if (config.kind === "node-api" && (config.networks ?? []).length > 0) {
    lines.push("", "networks:");
    for (const network of config.networks ?? []) {
      lines.push(`  ${network.name}:`, `    external: ${String(network.external)}`);
    }
  }

  return lines.join("\n") + "\n";
}

/** One compose-env variable a service's desired state declares. No value — see
 *  {@link DeployDesiredService}. */
export interface DeployDesiredEnvVar {
  readonly name: string;
  /** `false` only when the variable carries a default; a bare `${NAME}` reference is required. */
  readonly required: boolean;
}

/**
 * The desired-state shape `apps/deploy`'s reconcile report diffs against what Dokploy holds for
 * one service. `image` and `containerPort` are carried here for a later PR (the apply path) and
 * read by nothing in this one — see `apps/deploy/README.md`'s "Reconcile report" section.
 */
export interface DeployDesiredService {
  readonly appDir: string;
  readonly packageName: string;
  readonly kind: DeployAppConfig["kind"];
  /** Repo-root-relative, e.g. `"infra/docker/api-compose.yaml"` — no leading `./`. */
  readonly composePath: string;
  readonly image: string;
  readonly containerPort: number;
  /** `IMAGE_TAG` plus every `composeEnv` entry whose value is a variable reference, sorted by name. */
  readonly env: readonly DeployDesiredEnvVar[];
}

export type DeployDesiredState = readonly DeployDesiredService[];

function desiredEnvVars(config: DeployAppConfig): DeployDesiredEnvVar[] {
  const vars: DeployDesiredEnvVar[] = [{ name: IMAGE_TAG_VARIABLE, required: true }];

  if (config.kind === "node-api") {
    for (const env of config.composeEnv) {
      if (env.value.kind === "variable") {
        vars.push({ name: env.value.name, required: env.value.default === undefined });
      }
    }
  }

  return vars.sort((a, b) => a.name.localeCompare(b.name));
}

function desiredServiceForConfig(config: DeployAppConfig): DeployDesiredService {
  return {
    appDir: config.appDir,
    packageName: config.packageName,
    kind: config.kind,
    composePath: `infra/docker/${config.appDir}-compose.yaml`,
    image: `${IMAGE_REGISTRY_PREFIX}${config.appDir}`,
    containerPort:
      config.kind === "static-spa" ? STATIC_SPA_CONTAINER_PORT : NODE_API_CONTAINER_PORT,
    env: desiredEnvVars(config),
  };
}

/**
 * Renders `apps/deploy/src/reconcile/desired-state.gen.ts` — one {@link DeployDesiredService} per
 * `config`, sorted by `appDir`. String building only, same as {@link dockerfileFor} and
 * {@link composeFor}: this package keeps zero runtime dependencies.
 */
export function deployDesiredStateModule(configs: readonly DeployAppConfig[]): string {
  const services = [...configs].sort((a, b) => a.appDir.localeCompare(b.appDir));

  const lines: string[] = [
    "// GENERATED — edit the relevant apps/<app>/deploy.config.ts and run",
    "// `node ./infra/scripts/generate-deploy-config.mjs`, not this file.",
    "//",
    "// The desired-state manifest apps/deploy's reconcile report diffs against Dokploy. `image`",
    "// and `containerPort` are carried for a later PR (the apply path) and read by nothing in",
    "// this one — see apps/deploy/README.md.",
    'import type { DeployDesiredState } from "@unimatrix/deploy-config";',
    "",
    "export const DEPLOY_DESIRED_STATE: DeployDesiredState = [",
  ];

  for (const config of services) {
    const service = desiredServiceForConfig(config);

    lines.push(
      "  {",
      `    appDir: ${JSON.stringify(service.appDir)},`,
      `    packageName: ${JSON.stringify(service.packageName)},`,
      `    kind: ${JSON.stringify(service.kind)},`,
      `    composePath: ${JSON.stringify(service.composePath)},`,
      `    image: ${JSON.stringify(service.image)},`,
      `    containerPort: ${String(service.containerPort)},`,
      "    env: [",
    );

    for (const envVar of service.env) {
      lines.push(
        `      { name: ${JSON.stringify(envVar.name)}, required: ${String(envVar.required)} },`,
      );
    }

    lines.push("    ],", "  },");
  }

  lines.push("];", "");

  return lines.join("\n");
}
