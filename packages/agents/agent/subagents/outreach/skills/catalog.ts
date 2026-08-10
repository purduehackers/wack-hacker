import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import audiencesDoc from "../lib/skill_defs/audiences.md" with { type: "text" };
import broadcastsDoc from "../lib/skill_defs/broadcasts.md" with { type: "text" };
import crmWritesDoc from "../lib/skill_defs/crm-writes.md" with { type: "text" };
import dealsManagementDoc from "../lib/skill_defs/deals-management.md" with { type: "text" };
import domainsDoc from "../lib/skill_defs/domains.md" with { type: "text" };
import emailEnrichmentDoc from "../lib/skill_defs/email-enrichment.md" with { type: "text" };
import emailsDoc from "../lib/skill_defs/emails.md" with { type: "text" };
import statusTrackingDoc from "../lib/skill_defs/status-tracking.md" with { type: "text" };

export const OUTREACH_BASE_TOOL_NAMES = [
  "list_companies",
  "list_contacts",
  "list_deals",
  "get_company",
  "get_contact",
  "get_deal",
  "retrieve_crm_schema",
] as const;

export const OUTREACH_SKILL_DEFINITIONS = [
  {
    name: "audiences",
    minRole: "organizer",
    doc: audiencesDoc,
    tools: [
      "list_audiences",
      "get_audience",
      "create_audience",
      "delete_audience",
      "list_contacts_in_audience",
      "add_contact_to_audience",
      "remove_contact_from_audience",
    ],
  },
  {
    name: "broadcasts",
    minRole: "organizer",
    doc: broadcastsDoc,
    tools: [
      "list_broadcasts",
      "get_broadcast",
      "create_broadcast",
      "send_broadcast",
      "delete_broadcast",
    ],
  },
  {
    name: "crm-writes",
    minRole: "organizer",
    doc: crmWritesDoc,
    tools: [
      "create_company",
      "create_contact",
      "archive_company",
      "archive_contact",
      "update_company_status",
      "update_company_email",
      "update_company_next_followup",
      "update_contact_status",
      "update_contact_email",
    ],
  },
  {
    name: "deals-management",
    minRole: "organizer",
    doc: dealsManagementDoc,
    tools: ["create_deal", "update_deal_stage", "update_deal"],
  },
  {
    name: "domains",
    minRole: "admin",
    doc: domainsDoc,
    tools: ["list_domains", "get_domain", "create_domain", "verify_domain", "delete_domain"],
  },
  {
    name: "email-enrichment",
    minRole: "organizer",
    doc: emailEnrichmentDoc,
    tools: ["find_email_for_lead", "verify_email"],
  },
  {
    name: "emails",
    minRole: "organizer",
    doc: emailsDoc,
    tools: ["send_outreach_email", "get_email", "cancel_email"],
  },
  {
    name: "status-tracking",
    minRole: "organizer",
    doc: statusTrackingDoc,
    tools: ["get_email_status"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, OUTREACH_SKILL_DEFINITIONS),
  },
});
