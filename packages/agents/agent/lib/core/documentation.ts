import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../env.ts";
import { plainJson } from "./json.ts";

const PHACK_ASK_URL = "https://ask.purduehackers.com/api/query";
const documentationResponseSchema = z.json();

export const documentationInputSchema = z.strictObject({
  prompt: z.string().describe("The question to ask about Purdue Hackers"),
});

/** Query ask.purduehackers.com directly; no SDK or Discord credential crosses this boundary. */
export async function queryDocumentation(input: z.output<typeof documentationInputSchema>) {
  if (env.PHACK_ASK_API_KEY === undefined) {
    throw new UpstreamError({
      service: "Purdue Hackers knowledge base",
      status: 503,
      detail: "integration is not configured",
    });
  }

  const response = await fetch(PHACK_ASK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PHACK_ASK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: input.prompt }),
  });
  if (!response.ok) {
    return `Knowledge base query failed (${response.status}). Try rephrasing the question.`;
  }

  const parsed = documentationResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UpstreamError({
      service: "Purdue Hackers knowledge base",
      status: 502,
      detail: `response was not valid JSON: ${z.prettifyError(parsed.error)}`,
    });
  }
  return plainJson(parsed.data);
}
