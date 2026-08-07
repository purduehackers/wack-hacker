import { z } from "zod";

/** Plain-JSON contract returned by every delegated specialist to the root agent. */
export const SUBAGENT_OUTPUT_SCHEMA = z.strictObject({
  summary: z.string(),
  answer: z.string(),
  entities: z
    .array(
      z.strictObject({
        name: z.string(),
        type: z.string(),
        id: z.string(),
        url: z.string().url(),
      }),
    )
    .max(10),
});

export type SubagentOutput = z.infer<typeof SUBAGENT_OUTPUT_SCHEMA>;
