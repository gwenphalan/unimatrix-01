import type { HealthResponse, SecretsHealthResponse } from "../schemas/health.js";
import { healthResponseSchema, secretsHealthResponseSchema } from "../schemas/health.js";
import { defineApiContract } from "./api-contract.js";

export const healthContract = defineApiContract({
  method: "GET",
  path: "/health",
  responseSchema: healthResponseSchema,
});

export const secretsHealthContract = defineApiContract({
  method: "GET",
  path: "/health",
  responseSchema: secretsHealthResponseSchema,
});

export type HealthContract = typeof healthContract;
export type SecretsHealthContract = typeof secretsHealthContract;
export type { HealthResponse, SecretsHealthResponse };
