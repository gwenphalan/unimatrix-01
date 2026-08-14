import { z } from "zod";

/**
 * `settings.getDokployVersion` answers with a bare JSON string, not an object — measured
 * `"v0.29.13"` against the running instance on 2026-08-14. A wrapper object is the shape to expect
 * and the wrong one.
 */
export const dokployVersionSchema = z.string();

/**
 * Field-for-field as measured on 2026-08-14; every value arrives as a string, `ports` and `status`
 * included. `z.object`, not `z.strictObject`: Dokploy is upstream software this repo does not
 * control, and a new field appearing in a later release must not turn every call into a validation
 * error.
 */
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
