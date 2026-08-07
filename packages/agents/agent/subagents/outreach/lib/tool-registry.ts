import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import * as m_audiences from "./audiences.ts";
import * as m_broadcasts from "./broadcasts.ts";
import * as m_companies from "./companies.ts";
import * as m_contacts from "./contacts.ts";
import * as m_deals from "./deals.ts";
import * as m_domains from "./domains.ts";
import * as m_emails from "./emails.ts";
import * as m_enrichment from "./enrichment.ts";
import * as m_outreach from "./outreach.ts";
import * as m_schema from "./schema.ts";

export const OUTREACH_TOOLS = {
  add_contact_to_audience: m_audiences.add_contact_to_audience,
  archive_company: m_companies.archive_company,
  archive_contact: m_contacts.archive_contact,
  cancel_email: m_emails.cancel_email,
  create_audience: m_audiences.create_audience,
  create_broadcast: m_broadcasts.create_broadcast,
  create_company: m_companies.create_company,
  create_contact: m_contacts.create_contact,
  create_deal: m_deals.create_deal,
  create_domain: m_domains.create_domain,
  delete_audience: m_audiences.delete_audience,
  delete_broadcast: m_broadcasts.delete_broadcast,
  delete_domain: m_domains.delete_domain,
  find_email_for_lead: m_enrichment.find_email_for_lead,
  get_audience: m_audiences.get_audience,
  get_broadcast: m_broadcasts.get_broadcast,
  get_company: m_companies.get_company,
  get_contact: m_contacts.get_contact,
  get_deal: m_deals.get_deal,
  get_domain: m_domains.get_domain,
  get_email: m_emails.get_email,
  get_email_status: m_outreach.get_email_status,
  list_audiences: m_audiences.list_audiences,
  list_broadcasts: m_broadcasts.list_broadcasts,
  list_companies: m_companies.list_companies,
  list_contacts: m_contacts.list_contacts,
  list_contacts_in_audience: m_audiences.list_contacts_in_audience,
  list_deals: m_deals.list_deals,
  list_domains: m_domains.list_domains,
  remove_contact_from_audience: m_audiences.remove_contact_from_audience,
  retrieve_crm_schema: m_schema.retrieve_crm_schema,
  send_broadcast: m_broadcasts.send_broadcast,
  update_company_email: m_companies.update_company_email,
  update_company_next_followup: m_companies.update_company_next_followup,
  update_company_status: m_companies.update_company_status,
  update_contact_email: m_contacts.update_contact_email,
  update_contact_status: m_contacts.update_contact_status,
  update_deal: m_deals.update_deal,
  update_deal_stage: m_deals.update_deal_stage,
  verify_domain: m_domains.verify_domain,
  verify_email: m_enrichment.verify_email,
} as const satisfies Record<string, DomainToolSpec>;

export type OutreachToolName = keyof typeof OUTREACH_TOOLS;
