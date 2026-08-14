import { z } from "zod";

export const healthQuerySchema = z.strictObject({});

export const healthResponseSchema = z.strictObject({
  service: z.literal("api"),
  status: z.literal("ok"),
});

export const secretsHealthResponseSchema = z.strictObject({
  service: z.literal("secrets"),
  status: z.literal("ok"),
});

export const deployHealthResponseSchema = z.strictObject({
  service: z.literal("deploy"),
  status: z.literal("ok"),
});

export type HealthQuery = z.output<typeof healthQuerySchema>;
export type HealthResponse = z.output<typeof healthResponseSchema>;
export type SecretsHealthResponse = z.output<typeof secretsHealthResponseSchema>;
export type DeployHealthResponse = z.output<typeof deployHealthResponseSchema>;
