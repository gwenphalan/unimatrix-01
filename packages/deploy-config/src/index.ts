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
  /** `FROM node:${NODE_VERSION}-alpine AS base`. */
  readonly base: string;
  /** The final stage's `FROM` — nginx for a static SPA, node again for the API. */
  readonly runtime: string;
}
