import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

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
    description: "Manage Resend audiences (segments) and their contact rosters.",
    criteria:
      "Use when the user wants to list, create, or delete audiences, or add/remove contacts from an audience.",
    minRole: "organizer",
    tools: [
      "list_audiences",
      "get_audience",
      "create_audience",
      "delete_audience",
      "list_contacts_in_audience",
      "add_contact_to_audience",
      "remove_contact_from_audience",
    ],
    instructions:
      '- Resend calls these "segments" internally; "audience" is the product-level name.\n- add_contact_to_audience creates the contact if it doesn\'t already exist.\n- remove_contact_from_audience takes either contact_id (preferred) or email.\n- delete_audience removes the segment but does not delete the contacts.',
  },
  {
    name: "broadcasts",
    description: "Manage Resend broadcasts — mass email campaigns to audiences.",
    criteria: "Use when the user wants to create, schedule, send, or delete a Resend broadcast.",
    minRole: "organizer",
    tools: [
      "list_broadcasts",
      "get_broadcast",
      "create_broadcast",
      "send_broadcast",
      "delete_broadcast",
    ],
    instructions:
      '- Broadcasts target a Resend audience (segment). Use the audiences skill to pick one first.\n- create_broadcast creates a draft. send_broadcast dispatches it.\n- scheduled_at accepts ISO 8601 or natural language ("in 1 hour").\n- delete_broadcast only works on drafts — sent broadcasts are permanent.\n- The from address must be on a verified domain (see domains skill).',
  },
  {
    name: "crm-writes",
    description: "Update Company and Contact fields — status, email, next follow-up.",
    criteria:
      'Use when the user wants to change a Company or Contact row (e.g. mark "Contacted", set an email, schedule a follow-up).',
    minRole: "organizer",
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
    instructions:
      "<before-writing>\n- Always call `retrieve_crm_schema` first. Select option names must match exactly (Companies Status options differ from Contacts Status options).\n- Confirm the target page id via `list_companies` / `list_contacts` if the user referred to a row by name.\n</before-writing>\n\n<status-options>\n- Companies Status: `Not Contacted`, `Contacted`, `Awaiting Response`, `Donated` (verify via schema — there are 8 options total).\n- Contacts Status: `New`, `Nurturing`, `Active`, `Inactive`.\n</status-options>\n\n<scope>\n- Only write the fields the user explicitly asked for.\n- `update_company_next_followup` accepts an ISO `YYYY-MM-DD` date, or `null` to clear.\n- Setting an email does not trigger outreach — use `outreach-send` for that.\n</scope>",
  },
  {
    name: "deals-management",
    description: "Create and update Deal rows in the CRM.",
    criteria:
      "Use when the user wants to create a Deal, change a Deal's Stage, or edit Deal fields (amount, priority, close date, notes).",
    minRole: "organizer",
    tools: ["create_deal", "update_deal_stage", "update_deal"],
    instructions:
      "<stages>\n- Deal Stage is a status property with options: `Lead`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`.\n- Stage transitions are manual — never auto-advance based on email events or elapsed time.\n- Use `update_deal_stage` for Stage changes; `update_deal` for everything else.\n</stages>\n\n<creating>\n- New Deals default to Stage `Lead` unless the user specifies otherwise.\n- Amount is a USD number (no currency symbols).\n- Priority options: `High`, `Medium`, `Low`.\n- Close date is an ISO `YYYY-MM-DD`.\n- Notes write to the Notes rich_text property.\n</creating>\n\n<scope>\n- Only set fields the user explicitly asked for.\n- There are no Notion relations between Deals and Companies/Contacts — reference pages in prose instead.\n</scope>",
  },
  {
    name: "domains",
    description: "Manage Resend sending domains and their DNS verification.",
    criteria:
      "Use when the user wants to register a new sending domain, check verification status, or delete a domain (admin only for writes).",
    minRole: "admin",
    tools: ["list_domains", "get_domain", "create_domain", "verify_domain", "delete_domain"],
    instructions:
      "- create_domain returns DNS records the user must add at their registrar.\n- After DNS is configured, call verify_domain to kick off re-verification.\n- get_domain shows the current records and their match status.\n- delete_domain stops all sending from that domain immediately.",
  },
  {
    name: "email-enrichment",
    description: "Find and verify email addresses via Hunter.io.",
    criteria:
      "Use when the user asks to find an email for a lead, enrich a Company's contact info, or verify whether an address is deliverable.",
    minRole: "organizer",
    tools: ["find_email_for_lead", "verify_email"],
    instructions:
      "<finding>\n- `find_email_for_lead` needs a domain. Provide it directly, or pass a Notion `page_id` so the tool can read Website / Email and derive one.\n- If `full_name` (or `first_name` + `last_name`) is passed, Hunter `/v2/email-finder` returns a specific address.\n- Without a name, the tool falls back to `/v2/domain-search` and returns up to 10 candidate addresses with confidence scores.\n- Never guess email patterns locally — always route through Hunter.\n</finding>\n\n<verifying>\n- Always call `verify_email` before sending.\n- Block sends on `status`/`result` values of `undeliverable` or `risky` unless the user explicitly overrides.\n- `disposable: true` should also block automated outreach.\n</verifying>\n\n<scope>\n- Finding and verifying does not write to Notion. Use `crm-writes` (`update_company_email` / `update_contact_email`) to persist a verified address.\n</scope>",
  },
  {
    name: "emails",
    description: "Send one outreach email to one person, and inspect individual sends.",
    criteria:
      "Use when the user wants to email a specific company or contact, check the delivery status of a sent email, or cancel a scheduled one.",
    minRole: "organizer",
    tools: ["send_outreach_email", "get_email", "cancel_email"],
    instructions:
      "<sending>\n- `send_outreach_email` is the only way to email one person. It is approval-gated and cannot be undone.\n- Always `verify_email` first, and never send to an address whose status is undeliverable, risky, or disposable.\n- The tool refuses on its own when `Do Not Contact` is set or the row is from the wrong data source. Treat a refusal as final — do not retry with a different target.\n- On success it writes the message id and status back to the Notion row itself. Do not write those properties by hand.\n</sending>\n\n<inspecting>\n- get_email returns the current delivery status (sent, delivered, bounced, complained, opened, clicked).\n- cancel_email only works on scheduled emails that haven't sent yet.\n- For mass campaigns use the broadcasts skill, not this one.\n</inspecting>",
  },
  {
    name: "status-tracking",
    description: "Read the outreach tracking properties off a Company or Contact row.",
    criteria:
      "Use when the user wants to check whether an outreach landed, was opened, or bounced.",
    minRole: "organizer",
    tools: ["get_email_status"],
    instructions:
      '<reading>\n- `get_email_status` returns `Last Outreach ID`, `Outreach Status`, `Outreach Last Event At`, and `Do Not Contact` for a given page.\n- `send_outreach_email` is what writes them, at send time. Nothing updates them afterwards, so `Sent` means "we sent it", not "it was delivered" — say so rather than implying delivery.\n- To find out what actually happened to a specific send, take the `Last Outreach ID` and call `get_email` in the emails skill.\n</reading>\n\n<scope>\n- This skill is read-only. Use `crm-writes` to change any property manually.\n</scope>',
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, OUTREACH_SKILL_DEFINITIONS),
  },
});
