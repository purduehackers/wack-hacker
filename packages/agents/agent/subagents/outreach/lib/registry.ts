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
import audiencesDoc from "./skill_defs/audiences.md" with { type: "text" };
import broadcastsDoc from "./skill_defs/broadcasts.md" with { type: "text" };
import crmWritesDoc from "./skill_defs/crm-writes.md" with { type: "text" };
import dealsManagementDoc from "./skill_defs/deals-management.md" with { type: "text" };
import domainsDoc from "./skill_defs/domains.md" with { type: "text" };
import emailEnrichmentDoc from "./skill_defs/email-enrichment.md" with { type: "text" };
import emailsDoc from "./skill_defs/emails.md" with { type: "text" };
import statusTrackingDoc from "./skill_defs/status-tracking.md" with { type: "text" };
import { add_contact_to_audience } from "./tool_defs/audiences/add_contact_to_audience.ts";
import { create_audience } from "./tool_defs/audiences/create_audience.ts";
import { delete_audience } from "./tool_defs/audiences/delete_audience.ts";
import { get_audience } from "./tool_defs/audiences/get_audience.ts";
import { list_audiences } from "./tool_defs/audiences/list_audiences.ts";
import { list_contacts_in_audience } from "./tool_defs/audiences/list_contacts_in_audience.ts";
import { remove_contact_from_audience } from "./tool_defs/audiences/remove_contact_from_audience.ts";
import { get_company } from "./tool_defs/base/get_company.ts";
import { get_contact } from "./tool_defs/base/get_contact.ts";
import { get_deal } from "./tool_defs/base/get_deal.ts";
import { list_companies } from "./tool_defs/base/list_companies.ts";
import { list_contacts } from "./tool_defs/base/list_contacts.ts";
import { list_deals } from "./tool_defs/base/list_deals.ts";
import { retrieve_crm_schema } from "./tool_defs/base/retrieve_crm_schema.ts";
import { create_broadcast } from "./tool_defs/broadcasts/create_broadcast.ts";
import { delete_broadcast } from "./tool_defs/broadcasts/delete_broadcast.ts";
import { get_broadcast } from "./tool_defs/broadcasts/get_broadcast.ts";
import { list_broadcasts } from "./tool_defs/broadcasts/list_broadcasts.ts";
import { send_broadcast } from "./tool_defs/broadcasts/send_broadcast.ts";
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
import { create_domain } from "./tool_defs/domains/create_domain.ts";
import { delete_domain } from "./tool_defs/domains/delete_domain.ts";
import { get_domain } from "./tool_defs/domains/get_domain.ts";
import { list_domains } from "./tool_defs/domains/list_domains.ts";
import { verify_domain } from "./tool_defs/domains/verify_domain.ts";
import { find_email_for_lead } from "./tool_defs/email-enrichment/find_email_for_lead.ts";
import { verify_email } from "./tool_defs/email-enrichment/verify_email.ts";
import { cancel_email } from "./tool_defs/emails/cancel_email.ts";
import { get_email } from "./tool_defs/emails/get_email.ts";
import { send_outreach_email } from "./tool_defs/emails/send_outreach_email.ts";
import { get_email_status } from "./tool_defs/status-tracking/get_email_status.ts";

export const OUTREACH_TOOLS = {
  add_contact_to_audience,
  archive_company,
  archive_contact,
  cancel_email,
  create_audience,
  create_broadcast,
  create_company,
  create_contact,
  create_deal,
  create_domain,
  delete_audience,
  delete_broadcast,
  delete_domain,
  find_email_for_lead,
  get_audience,
  get_broadcast,
  get_company,
  get_contact,
  get_deal,
  get_domain,
  get_email,
  get_email_status,
  list_audiences,
  list_broadcasts,
  list_companies,
  list_contacts,
  list_contacts_in_audience,
  list_deals,
  list_domains,
  remove_contact_from_audience,
  retrieve_crm_schema,
  send_broadcast,
  send_outreach_email,
  update_company_email,
  update_company_next_followup,
  update_company_status,
  update_contact_email,
  update_contact_status,
  update_deal,
  update_deal_stage,
  verify_domain,
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
