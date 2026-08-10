import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { OUTREACH_TOOLS } from "./registry.ts";

/**
 * `find_email_for_lead` only reaches Notion when it has to derive the company
 * domain from a CRM page: a page id is present and no usable domain came with
 * the call. Matched against the raw arguments, before the tool schema parses.
 *
 * This is the one credential requirement in this domain that depends on the
 * call rather than the tool. Every other one is a `requires` key on the tool
 * spec, checked against `credentials` below.
 */
const notionDerivedLeadSchema = z.looseObject({
  page_id: z.string(),
  domain: z.literal("").optional(),
});

export const OUTREACH_RUNTIME = createDomainRuntime({
  domain: "outreach",
  label: "Outreach",
  service: "Outreach",
  tools: OUTREACH_TOOLS,
  credentials: {
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
    HUNTER_API_KEY: env.HUNTER_API_KEY,
    NOTION_TOKEN: env.NOTION_TOKEN,
  },
  configurationError: (name, input) => {
    const derivesDomainFromNotion =
      name === "find_email_for_lead" && notionDerivedLeadSchema.safeParse(input).success;
    return derivesDomainFromNotion && env.NOTION_TOKEN === undefined
      ? new UpstreamError({
          service: "Outreach",
          status: 401,
          detail: "NOTION_TOKEN is not configured",
        })
      : undefined;
  },
});
