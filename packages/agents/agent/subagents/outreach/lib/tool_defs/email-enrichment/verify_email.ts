import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hunter } from "../../client.ts";
import { ABSENT } from "../../constants.ts";

const emailVerifierResponseSchema = z.object({
  data: z
    .object({
      status: z.string().optional(),
      result: z.string().optional(),
      score: z.number().optional(),
      regexp: z.boolean().optional(),
      smtp_check: z.boolean().optional(),
      disposable: z.boolean().optional(),
    })
    .optional(),
});
type EmailVerifierResponse = z.output<typeof emailVerifierResponseSchema>;

export const verify_email = defineTool({
  description: `Verify an email address via Hunter /v2/email-verifier. Returns status ("deliverable", "undeliverable", "risky", "unknown") plus score. Treat "risky" and "undeliverable" as blockers unless the user overrides.`,
  access: { risk: "read" },
  requires: "HUNTER_API_KEY",
  input: z.strictObject({
    email: z.email(),
  }),
  execute: async ({ email }) => {
    const result: EmailVerifierResponse = await hunter(
      "email-verifier",
      { email },
      emailVerifierResponseSchema,
    );
    return {
      email,
      status: result.data?.status ?? ABSENT,
      result: result.data?.result ?? ABSENT,
      score: result.data?.score ?? ABSENT,
      disposable: result.data?.disposable ?? ABSENT,
    };
  },
});
