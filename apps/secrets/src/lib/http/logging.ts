import type { FastifyServerOptions } from "fastify";

import type { SecretsRuntimeConfigBase } from "../../config.js";

type SecretsLoggerOptions = Exclude<NonNullable<FastifyServerOptions["logger"]>, boolean>;

/**
 * Measured on Fastify 5.10.0: the default `req` serializer emits `method`,
 * `url`, `host` and `remoteAddress` and no headers at all, so a bearer token
 * does not reach a log line by the current path. This list is the guard against
 * a custom serializer later, not something doing work today.
 */
const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.proxy-authorization",
  "req.headers['set-cookie']",
  "res.headers['set-cookie']",
] as const;

export interface SecretsLoggerStream {
  write: (chunk: string) => void;
}

export interface BuildSecretsLoggerOptions {
  /** Where records go instead of stdout. Tests pass one to assert on redaction. */
  stream?: SecretsLoggerStream;
}

/**
 * No `pino-pretty` transport, unlike `apps/api`: it is a development nicety
 * backed by a devDependency this workspace does not carry.
 */
export function buildLoggerOptions(
  config: Pick<SecretsRuntimeConfigBase, "logLevel">,
  options: BuildSecretsLoggerOptions = {},
): SecretsLoggerOptions {
  return {
    level: config.logLevel,
    redact: {
      paths: [...REDACTED_LOG_PATHS],
      censor: "[REDACTED]",
    },
    ...(options.stream === undefined ? {} : { stream: options.stream }),
  };
}
