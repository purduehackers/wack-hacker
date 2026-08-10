/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and splitting them is what let the old
 * `edge.ts` accumulate 34 tools that no single skill described. `tool_defs/`
 * mirrors the skill list exactly, and `check:capabilities` fails if it stops
 * doing so.
 *
 * Skill prose lives in `skills/<name>.md`, not here.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkill } from "../../../lib/policy/registry.ts";
import { get_zone } from "./tool_defs/base/get_zone.ts";
import { list_zones } from "./tool_defs/base/list_zones.ts";
import { create_destination_address } from "./tool_defs/destination-addresses/create_destination_address.ts";
import { delete_destination_address } from "./tool_defs/destination-addresses/delete_destination_address.ts";
import { get_destination_address } from "./tool_defs/destination-addresses/get_destination_address.ts";
import { list_destination_addresses } from "./tool_defs/destination-addresses/list_destination_addresses.ts";
import { create_dns_record } from "./tool_defs/dns-records/create_dns_record.ts";
import { delete_dns_record } from "./tool_defs/dns-records/delete_dns_record.ts";
import { export_zone_file } from "./tool_defs/dns-records/export_zone_file.ts";
import { get_dns_record } from "./tool_defs/dns-records/get_dns_record.ts";
import { list_dns_records } from "./tool_defs/dns-records/list_dns_records.ts";
import { update_dns_record } from "./tool_defs/dns-records/update_dns_record.ts";
import { create_routing_rule } from "./tool_defs/email-routing/create_routing_rule.ts";
import { delete_routing_rule } from "./tool_defs/email-routing/delete_routing_rule.ts";
import { disable_email_routing } from "./tool_defs/email-routing/disable_email_routing.ts";
import { enable_email_routing } from "./tool_defs/email-routing/enable_email_routing.ts";
import { get_catch_all_rule } from "./tool_defs/email-routing/get_catch_all_rule.ts";
import { get_routing_dns } from "./tool_defs/email-routing/get_routing_dns.ts";
import { get_routing_rule } from "./tool_defs/email-routing/get_routing_rule.ts";
import { get_routing_settings } from "./tool_defs/email-routing/get_routing_settings.ts";
import { list_routing_rules } from "./tool_defs/email-routing/list_routing_rules.ts";
import { update_catch_all_rule } from "./tool_defs/email-routing/update_catch_all_rule.ts";
import { update_routing_rule } from "./tool_defs/email-routing/update_routing_rule.ts";
import { send_email } from "./tool_defs/email-sending/send_email.ts";
import { create_sending_subdomain } from "./tool_defs/sending-domains/create_sending_subdomain.ts";
import { delete_sending_subdomain } from "./tool_defs/sending-domains/delete_sending_subdomain.ts";
import { get_sending_dns_records } from "./tool_defs/sending-domains/get_sending_dns_records.ts";
import { get_sending_subdomain } from "./tool_defs/sending-domains/get_sending_subdomain.ts";
import { list_sending_subdomains } from "./tool_defs/sending-domains/list_sending_subdomains.ts";

export const CLOUDFLARE_TOOLS = {
  create_destination_address,
  create_dns_record,
  create_routing_rule,
  create_sending_subdomain,
  delete_destination_address,
  delete_dns_record,
  delete_routing_rule,
  delete_sending_subdomain,
  disable_email_routing,
  enable_email_routing,
  export_zone_file,
  get_catch_all_rule,
  get_destination_address,
  get_dns_record,
  get_routing_dns,
  get_routing_rule,
  get_routing_settings,
  get_sending_dns_records,
  get_sending_subdomain,
  get_zone,
  list_destination_addresses,
  list_dns_records,
  list_routing_rules,
  list_sending_subdomains,
  list_zones,
  send_email,
  update_catch_all_rule,
  update_dns_record,
  update_routing_rule,
} as const satisfies Record<string, DomainToolSpec>;

export type CloudflareToolName = keyof typeof CLOUDFLARE_TOOLS;

export const CLOUDFLARE_BASE_TOOL_NAMES = ["list_zones", "get_zone"] as const;

export const CLOUDFLARE_SKILLS = [
  {
    name: "dns-records",
    minRole: "organizer",
    tools: [
      "list_dns_records",
      "get_dns_record",
      "create_dns_record",
      "update_dns_record",
      "delete_dns_record",
      "export_zone_file",
    ],
  },
  {
    name: "email-routing",
    minRole: "organizer",
    tools: [
      "get_routing_settings",
      "enable_email_routing",
      "disable_email_routing",
      "list_routing_rules",
      "get_routing_rule",
      "create_routing_rule",
      "update_routing_rule",
      "delete_routing_rule",
      "get_catch_all_rule",
      "update_catch_all_rule",
      "get_routing_dns",
    ],
  },
  {
    name: "destination-addresses",
    minRole: "organizer",
    tools: [
      "list_destination_addresses",
      "get_destination_address",
      "create_destination_address",
      "delete_destination_address",
    ],
  },
  {
    name: "email-sending",
    minRole: "organizer",
    tools: ["send_email"],
  },
  {
    name: "sending-domains",
    minRole: "organizer",
    tools: [
      "list_sending_subdomains",
      "get_sending_subdomain",
      "create_sending_subdomain",
      "delete_sending_subdomain",
      "get_sending_dns_records",
    ],
  },
] as const satisfies readonly IntegrationSkill[];
