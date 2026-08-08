import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  healthQuerySchema,
  secretsHealthContract,
  type SecretsHealthResponse,
} from "@unimatrix/shared";

const healthResponse: SecretsHealthResponse = {
  service: "secrets",
  status: "ok",
};

export const healthModule: FastifyPluginAsync = (app) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: secretsHealthContract.method,
    url: secretsHealthContract.path,
    schema: {
      querystring: healthQuerySchema,
      response: {
        200: secretsHealthContract.responseSchema,
      },
    },
    handler: (_request, reply) => {
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
      reply.header("Pragma", "no-cache");

      return healthResponse;
    },
  });

  return Promise.resolve();
};
