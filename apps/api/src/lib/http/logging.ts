import type { FastifyServerOptions } from "fastify";

import type { ApiRuntimeConfig } from "../../config.js";

type ApiLoggerOptions = Exclude<NonNullable<FastifyServerOptions["logger"]>, boolean>;

const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.proxy-authorization",
  "req.headers['set-cookie']",
  "res.headers['set-cookie']",
] as const;

export interface ApiLoggerStream {
  write: (chunk: string) => void;
}

export interface BuildApiLoggerOptions {
  /** Where records go instead of stdout. Tests pass one to assert on redaction. */
  stream?: ApiLoggerStream;
}

/**
 * Fastify 5.10.0 accepts `{ transport, stream }` together without throwing
 * (measured), but which sink wins was not measured — a test asserting on
 * `stream` should pin `NODE_ENV=test` so the development-only `transport`
 * branch below is never added in the first place.
 */
export function buildLoggerOptions(
  config: ApiRuntimeConfig,
  options: BuildApiLoggerOptions = {},
): ApiLoggerOptions {
  const isDevelopment = config.nodeEnv === "development";

  return {
    level: config.logLevel,
    redact: {
      paths: [...REDACTED_LOG_PATHS],
      censor: "[REDACTED]",
    },
    ...(isDevelopment
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              ignore: "pid,hostname",
              translateTime: "SYS:standard",
            },
          },
        }
      : {}),
    ...(options.stream === undefined ? {} : { stream: options.stream }),
  };
}
