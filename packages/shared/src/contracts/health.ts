import type { DeployHealthResponse, HealthResponse, SecretsHealthResponse } from "../schemas/health.js";
import {
  deployHealthResponseSchema,
  healthResponseSchema,
  secretsHealthResponseSchema,
} from "../schemas/health.js";
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

export const deployHealthContract = defineApiContract({
  method: "GET",
  path: "/health",
  responseSchema: deployHealthResponseSchema,
});

export type HealthContract = typeof healthContract;
export type SecretsHealthContract = typeof secretsHealthContract;
export type DeployHealthContract = typeof deployHealthContract;
export type { DeployHealthResponse, HealthResponse, SecretsHealthResponse };
