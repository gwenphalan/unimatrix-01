import { z } from "zod";

/**
 * `z.object`, not `z.strictObject`: Dokploy is upstream software this repo does not control, and a
 * new field appearing in a later Dokploy release must not turn every call into a validation error.
 */
export const dokployVersionSchema = z.object({
  version: z.string(),
});

export const dokployContainerSchema = z.object({
  containerId: z.string(),
  name: z.string(),
  image: z.string(),
  ports: z.string(),
  state: z.string(),
  status: z.string(),
});

export const dokployContainersSchema = z.array(dokployContainerSchema);

export type DokployVersion = z.output<typeof dokployVersionSchema>;
export type DokployContainer = z.output<typeof dokployContainerSchema>;
