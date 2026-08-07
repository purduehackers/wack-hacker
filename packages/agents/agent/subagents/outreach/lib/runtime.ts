import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { OUTREACH_TOOLS, type OutreachToolName } from "./tool-registry.ts";

const RESEND_TOOL_NAMES = new Set<OutreachToolName>([
  "add_contact_to_audience",
  "cancel_email",
  "create_audience",
  "create_broadcast",
  "create_domain",
  "delete_audience",
  "delete_broadcast",
  "delete_domain",
  "get_audience",
  "get_broadcast",
  "get_domain",
  "get_email",
  "list_audiences",
  "list_broadcasts",
  "list_contacts_in_audience",
  "list_domains",
  "remove_contact_from_audience",
  "send_broadcast",
  "verify_domain",
]);
const NOTION_TOOL_NAMES = new Set<OutreachToolName>([
  "archive_company",
  "archive_contact",
  "create_company",
  "create_contact",
  "create_deal",
  "get_company",
  "get_contact",
  "get_deal",
  "get_email_status",
  "list_companies",
  "list_contacts",
  "list_deals",
  "retrieve_crm_schema",
  "update_company_email",
  "update_company_next_followup",
  "update_company_status",
  "update_contact_email",
  "update_contact_status",
  "update_deal",
  "update_deal_stage",
]);
const HUNTER_TOOL_NAMES = new Set<OutreachToolName>(["find_email_for_lead", "verify_email"]);

export const OUTREACH_RUNTIME = createDomainRuntime({
  domain: "outreach",
  label: "Outreach",
  service: "Outreach",
  tools: OUTREACH_TOOLS,
  configurationError: (name, input) => {
    if (RESEND_TOOL_NAMES.has(name) && env.RESEND_API_KEY === undefined) {
      return new UpstreamError({
        service: "Outreach",
        status: 401,
        detail: "RESEND_API_KEY is not configured",
      });
    }
    if (HUNTER_TOOL_NAMES.has(name) && env.HUNTER_API_KEY === undefined) {
      return new UpstreamError({
        service: "Outreach",
        status: 401,
        detail: "HUNTER_API_KEY is not configured",
      });
    }
    const usesNotion =
      NOTION_TOOL_NAMES.has(name) ||
      (name === "find_email_for_lead" &&
        typeof input === "object" &&
        input !== null &&
        "page_id" in input &&
        !("domain" in input && typeof input.domain === "string" && input.domain.length > 0));
    if (usesNotion && env.NOTION_TOKEN === undefined) {
      return new UpstreamError({
        service: "Outreach",
        status: 401,
        detail: "NOTION_TOKEN is not configured",
      });
    }
    return undefined;
  },
});
