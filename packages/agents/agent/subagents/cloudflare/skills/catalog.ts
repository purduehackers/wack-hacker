import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const CLOUDFLARE_BASE_TOOL_NAMES = ["list_zones", "get_zone"] as const;

export const CLOUDFLARE_SKILL_DEFINITIONS = [
  {
    name: "dns-records",
    description: "Read and change DNS records on a Cloudflare zone.",
    criteria:
      "Use when the user asks what a domain's DNS says, or asks to add, change, or remove a DNS record.",
    minRole: "organizer",
    tools: [
      "list_dns_records",
      "get_dns_record",
      "create_dns_record",
      "update_dns_record",
      "delete_dns_record",
      "export_zone_file",
    ],
    instructions:
      "<reading>\n- Resolve the domain to a zone id with `list_zones` first; every tool here needs one.\n- Filter with `name` and `type` rather than paging the whole zone — `list_dns_records({ type: 'MX' })` answers a mail question directly.\n</reading>\n\n<writing>\n- `update_dns_record` replaces the whole record: read it with `get_dns_record` first and pass back the current value of anything you are not changing, or it will be cleared.\n- Supported types are A, AAAA, CNAME, MX, NS and TXT. MX needs `priority`. Anything else has to be done in the Cloudflare dashboard.\n- `proxied` only applies to A, AAAA and CNAME.\n</writing>\n\n<mail-safety>\n- MX records and the TXT records holding SPF, DKIM and DMARC are load-bearing for the whole domain's mail. Read the record back and say what it does before changing or deleting it.\n- A domain may only have one SPF TXT record. To authorize a new sender, edit the existing record to add an `include:` — never create a second one.\n</mail-safety>",
  },
  {
    name: "email-routing",
    description: "Manage where inbound mail for a domain is forwarded.",
    criteria:
      "Use when the user asks where mail to an address goes, wants to forward a new address, or wants to change or remove a forward.",
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
    instructions:
      '<orientation>\n- `list_routing_rules` then `get_catch_all_rule` is the complete answer to "where does mail for this domain go" — an address with no rule of its own is handled by the catch-all.\n- Routing is inbound only. It cannot send anything; that is the email-sending skill.\n</orientation>\n\n<forwarding>\n- A rule can only forward to a destination address that already exists and is verified. Check `list_destination_addresses({ verified_only: true })` first; if the address is missing, create it and tell the user to click the confirmation link before the rule will deliver.\n- `update_routing_rule` replaces the rule wholesale, so pass the full intended match and destination list.\n</forwarding>\n\n<danger>\n- `enable_email_routing` takes over the zone\'s MX records, which stops any other mail provider on that domain from receiving mail. `disable_email_routing` stops all forwarding at once. Both need explicit confirmation of the consequence, not just of the action.\n- A catch-all set to drop silently discards mail to every address without its own rule. Say that plainly before setting it.\n</danger>',
  },
  {
    name: "destination-addresses",
    description: "Manage the account's verified Email Routing destinations.",
    criteria:
      "Use when the user wants to add, list, or remove an address that Cloudflare is allowed to forward mail to.",
    minRole: "organizer",
    tools: [
      "list_destination_addresses",
      "get_destination_address",
      "create_destination_address",
      "delete_destination_address",
    ],
    instructions:
      "- Destinations are account-wide, not per zone, so one verified address can receive forwards from any Purdue Hackers domain.\n- Creating one sends a confirmation email to that address. Until the owner clicks the link it cannot receive forwarded mail, and any rule pointing at it silently fails to deliver — always tell the user this.\n- Deleting a destination breaks every rule still forwarding to it. Check `list_routing_rules` on the relevant zones first and say which forwards will stop.",
  },
  {
    name: "email-sending",
    description: "Send a one-off transactional email from a verified domain.",
    criteria:
      "Use when the user wants to send a single email that is not CRM outreach and not an event blast.",
    minRole: "organizer",
    tools: ["send_email"],
    instructions:
      "<before-sending>\n- The From address must be on a domain onboarded for Email Sending. `list_sending_subdomains` confirms it; a domain that merely has DNS records is not enough.\n- Show the user the exact From, To, subject and body and get agreement before calling. This cannot be recalled.\n</before-sending>\n\n<after-sending>\n- Read the result rather than assuming success. `permanent_bounces` comes back inside a successful response, so an address listed there was not delivered even though nothing threw.\n- `queued` means accepted for later delivery, not delivered. Report it as queued.\n- Keep the `message_id` — it is how a specific send is looked up later.\n</after-sending>\n\n<wrong-tool>\n- CRM outreach to a company or contact goes through the outreach subagent's `send_outreach_email`, which also honors Do Not Contact and records the send. Do not reimplement that here.\n- Event and RSVP blasts belong to the CMS send pipeline. This service is transactional only and must not be used for newsletters.\n</wrong-tool>",
  },
  {
    name: "sending-domains",
    description: "Onboard and inspect domains authorized to send mail.",
    criteria:
      "Use when the user wants to start sending from a new domain, or asks why sending from a domain is failing.",
    minRole: "organizer",
    tools: [
      "list_sending_subdomains",
      "get_sending_subdomain",
      "create_sending_subdomain",
      "delete_sending_subdomain",
      "get_sending_dns_records",
    ],
    instructions:
      "<onboarding>\n1. `create_sending_subdomain` for the domain or subdomain to send from.\n2. `get_sending_dns_records` to read the SPF, DKIM and DMARC records it requires.\n3. Create each one with `create_dns_record` from the dns-records skill.\n4. `get_sending_subdomain` to confirm verification before anyone tries to send.\n</onboarding>\n\n<notes>\n- Cloudflare publishes these under a `cf-bounce` subdomain, so onboarding an apex domain does not disturb the apex's own MX or SPF.\n- If the zone already has an SPF record, extend it with an `include:` rather than adding a second — a domain with two SPF records fails authentication entirely.\n- Deleting a sending domain immediately breaks every service sending as it. Ask what else sends from that domain before removing it.\n</notes>",
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, CLOUDFLARE_SKILL_DEFINITIONS),
  },
});
