/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and splitting them is what let the grouped
 * modules accumulate tools no single skill described. `tool_defs/` mirrors the
 * skill list exactly, and `check:capabilities` fails if it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import crmWritesDoc from "./skill_defs/crm-writes.md" with { type: "text" };
import dealsManagementDoc from "./skill_defs/deals-management.md" with { type: "text" };
import emailEnrichmentDoc from "./skill_defs/email-enrichment.md" with { type: "text" };
import emailsDoc from "./skill_defs/emails.md" with { type: "text" };
import statusTrackingDoc from "./skill_defs/status-tracking.md" with { type: "text" };
import { get_company } from "./tool_defs/base/get_company.ts";
import { get_contact } from "./tool_defs/base/get_contact.ts";
import { get_deal } from "./tool_defs/base/get_deal.ts";
import { list_companies } from "./tool_defs/base/list_companies.ts";
import { list_contacts } from "./tool_defs/base/list_contacts.ts";
import { list_deals } from "./tool_defs/base/list_deals.ts";
import { retrieve_crm_schema } from "./tool_defs/base/retrieve_crm_schema.ts";
import { archive_company } from "./tool_defs/crm-writes/archive_company.ts";
import { archive_contact } from "./tool_defs/crm-writes/archive_contact.ts";
import { create_company } from "./tool_defs/crm-writes/create_company.ts";
import { create_contact } from "./tool_defs/crm-writes/create_contact.ts";
import { update_company_email } from "./tool_defs/crm-writes/update_company_email.ts";
import { update_company_next_followup } from "./tool_defs/crm-writes/update_company_next_followup.ts";
import { update_company_status } from "./tool_defs/crm-writes/update_company_status.ts";
import { update_contact_email } from "./tool_defs/crm-writes/update_contact_email.ts";
import { update_contact_status } from "./tool_defs/crm-writes/update_contact_status.ts";
import { create_deal } from "./tool_defs/deals-management/create_deal.ts";
import { update_deal } from "./tool_defs/deals-management/update_deal.ts";
import { update_deal_stage } from "./tool_defs/deals-management/update_deal_stage.ts";
import { find_email_for_lead } from "./tool_defs/email-enrichment/find_email_for_lead.ts";
import { verify_email } from "./tool_defs/email-enrichment/verify_email.ts";
import { send_outreach_email } from "./tool_defs/emails/send_outreach_email.ts";
import { get_email_status } from "./tool_defs/status-tracking/get_email_status.ts";

export const OUTREACH_TOOLS = {
  archive_company,
  archive_contact,
  create_company,
  create_contact,
  create_deal,
  find_email_for_lead,
  get_company,
  get_contact,
  get_deal,
  get_email_status,
  list_companies,
  list_contacts,
  list_deals,
  retrieve_crm_schema,
  send_outreach_email,
  update_company_email,
  update_company_next_followup,
  update_company_status,
  update_contact_email,
  update_contact_status,
  update_deal,
  update_deal_stage,
  verify_email,
} as const satisfies Record<string, DomainToolSpec>;

export type OutreachToolName = keyof typeof OUTREACH_TOOLS;

export const OUTREACH_BASE_TOOL_NAMES = [
  "list_companies",
  "list_contacts",
  "list_deals",
  "get_company",
  "get_contact",
  "get_deal",
  "retrieve_crm_schema",
] as const;

export const OUTREACH_SKILLS = [
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
    name: "email-enrichment",
    minRole: "organizer",
    doc: emailEnrichmentDoc,
    tools: ["find_email_for_lead", "verify_email"],
  },
  {
    name: "emails",
    minRole: "organizer",
    doc: emailsDoc,
    tools: ["send_outreach_email"],
  },
  {
    name: "status-tracking",
    minRole: "organizer",
    doc: statusTrackingDoc,
    tools: ["get_email_status"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];
