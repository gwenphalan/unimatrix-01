import type { FastifyError } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

/**
 * Named `SecretsHttpError` rather than `SecretsError`: `@unimatrix/secrets`
 * already exports a `SecretsError` carrying a `SecretsErrorCode`, and a
 * same-named class in the service that consumes it is a collision waiting for
 * the first file needing both.
 */
export type SecretsHttpErrorCode =
  "UNAUTHORIZED" | "VALIDATION_ERROR" | "NOT_FOUND" | "RATE_LIMITED" | "INTERNAL_ERROR";

/**
 * Deliberately flatter than `apps/api`'s: no `statusCode` inside the body, no
 * `requestId`, no validation-issue detail. There is no browser client and no
 * support workflow to correlate one, and the request id is already on every log
 * line.
 */
export interface SecretsHttpErrorEnvelope {
  error: {
    code: SecretsHttpErrorCode;
    message: string;
  };
}

type SecretsHttpLogLevel = "info" | "warn" | "error";

export interface NormalizedSecretsHttpError {
  statusCode: number;
  envelope: SecretsHttpErrorEnvelope;
  logLevel: SecretsHttpLogLevel;
}

interface SecretsHttpErrorOptions {
  statusCode: number;
  code: SecretsHttpErrorCode;
  message: string;
  cause?: unknown;
}

export class SecretsHttpError extends Error {
  readonly statusCode: number;
  readonly code: SecretsHttpErrorCode;

  constructor(options: SecretsHttpErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });

    this.name = "SecretsHttpError";
    this.statusCode = options.statusCode;
    this.code = options.code;
  }
}

function createErrorEnvelope(
  code: SecretsHttpErrorCode,
  message: string,
): SecretsHttpErrorEnvelope {
  return { error: { code, message } };
}

export function createNotFoundErrorEnvelope(): SecretsHttpErrorEnvelope {
  return createErrorEnvelope("NOT_FOUND", "Route not found");
}

export function createUnauthorizedErrorEnvelope(): SecretsHttpErrorEnvelope {
  return createErrorEnvelope("UNAUTHORIZED", "A valid service token is required");
}

function getFastifyStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }

  const { statusCode } = error as FastifyError;

  return typeof statusCode === "number" ? statusCode : undefined;
}

function getFastifyErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return "Request failed";
  }

  const { message } = error as FastifyError;

  return typeof message === "string" && message.length > 0 ? message : "Request failed";
}

/**
 * Anything unrecognised becomes a bare `INTERNAL_ERROR` with no detail in the
 * body, which is what keeps a `SecretsError` from `@unimatrix/secrets` out of a
 * response: its `code` names the failing crypto operation and belongs in the
 * log, not on the wire. That works because it carries no `statusCode`, so it
 * cannot be mistaken for a client error below.
 */
export function normalizeSecretsError(error: unknown): NormalizedSecretsHttpError {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return {
      statusCode: 400,
      envelope: createErrorEnvelope("VALIDATION_ERROR", "Request validation failed"),
      logLevel: "warn",
    };
  }

  if (error instanceof SecretsHttpError) {
    return {
      statusCode: error.statusCode,
      envelope: createErrorEnvelope(error.code, error.message),
      logLevel: error.statusCode >= 500 ? "error" : "warn",
    };
  }

  const statusCode = getFastifyStatusCode(error);

  if (statusCode === 404) {
    return { statusCode, envelope: createNotFoundErrorEnvelope(), logLevel: "info" };
  }

  // Ahead of the generic client-error branch so the ceiling stays nameable: a
  // caller retrying after a 429 needs to know it was rate-limited rather than
  // that it sent something malformed.
  if (statusCode === 429) {
    return {
      statusCode,
      envelope: createErrorEnvelope("RATE_LIMITED", getFastifyErrorMessage(error)),
      logLevel: "warn",
    };
  }

  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return {
      statusCode,
      envelope: createErrorEnvelope("VALIDATION_ERROR", getFastifyErrorMessage(error)),
      logLevel: "warn",
    };
  }

  return {
    statusCode: 500,
    envelope: createErrorEnvelope("INTERNAL_ERROR", "Internal server error"),
    logLevel: "error",
  };
}
