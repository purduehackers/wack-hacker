import { z } from "zod";

/** Plain-JSON contract returned by every delegated specialist to the root agent. */
export const SUBAGENT_OUTPUT_SCHEMA = z.strictObject({
  artifacts: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-f0-9]{32}$/u),
        kind: z.enum(["dataset", "chart"]),
      }),
    )
    .max(10)
    .optional(),
  summary: z.string(),
  answer: z.string(),
  entities: z
    .array(
      z.strictObject({
        name: z.string(),
        type: z.string(),
        id: z.string(),
        url: z.url(),
      }),
    )
    .max(10),
});
