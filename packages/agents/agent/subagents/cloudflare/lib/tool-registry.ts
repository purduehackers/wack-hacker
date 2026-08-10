import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import * as m_dns from "./dns.ts";
import * as m_routing from "./routing.ts";
import * as m_sending from "./sending.ts";
import * as m_zones from "./zones.ts";

export const CLOUDFLARE_TOOLS = {
  create_destination_address: m_routing.create_destination_address,
  create_dns_record: m_dns.create_dns_record,
  create_routing_rule: m_routing.create_routing_rule,
  create_sending_subdomain: m_sending.create_sending_subdomain,
  delete_destination_address: m_routing.delete_destination_address,
  delete_dns_record: m_dns.delete_dns_record,
  delete_routing_rule: m_routing.delete_routing_rule,
  delete_sending_subdomain: m_sending.delete_sending_subdomain,
  disable_email_routing: m_routing.disable_email_routing,
  enable_email_routing: m_routing.enable_email_routing,
  export_zone_file: m_dns.export_zone_file,
  get_catch_all_rule: m_routing.get_catch_all_rule,
  get_destination_address: m_routing.get_destination_address,
  get_dns_record: m_dns.get_dns_record,
  get_routing_dns: m_routing.get_routing_dns,
  get_routing_rule: m_routing.get_routing_rule,
  get_routing_settings: m_routing.get_routing_settings,
  get_sending_dns_records: m_sending.get_sending_dns_records,
  get_sending_subdomain: m_sending.get_sending_subdomain,
  get_zone: m_zones.get_zone,
  list_destination_addresses: m_routing.list_destination_addresses,
  list_dns_records: m_dns.list_dns_records,
  list_routing_rules: m_routing.list_routing_rules,
  list_sending_subdomains: m_sending.list_sending_subdomains,
  list_zones: m_zones.list_zones,
  send_email: m_sending.send_email,
  update_catch_all_rule: m_routing.update_catch_all_rule,
  update_dns_record: m_dns.update_dns_record,
  update_routing_rule: m_routing.update_routing_rule,
} as const satisfies Record<string, DomainToolSpec>;

export type CloudflareToolName = keyof typeof CLOUDFLARE_TOOLS;
