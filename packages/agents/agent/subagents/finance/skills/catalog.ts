import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import cardChargesDoc from "../lib/skill_defs/card-charges.md" with { type: "text" };
import donationsDoc from "../lib/skill_defs/donations.md" with { type: "text" };
import invoicesDoc from "../lib/skill_defs/invoices.md" with { type: "text" };
import receiptsDoc from "../lib/skill_defs/receipts.md" with { type: "text" };
import transactionsDoc from "../lib/skill_defs/transactions.md" with { type: "text" };
import transfersDoc from "../lib/skill_defs/transfers.md" with { type: "text" };

export const FINANCE_BASE_TOOL_NAMES = [
  "get_organization",
  "get_balance",
  "list_transactions",
  "get_transaction",
] as const;

export const FINANCE_SKILL_DEFINITIONS = [
  {
    name: "card-charges",
    minRole: "organizer",
    doc: cardChargesDoc,
    tools: ["list_card_charges"],
  },
  {
    name: "donations",
    minRole: "organizer",
    doc: donationsDoc,
    tools: ["list_donations", "get_donation", "donation_totals"],
  },
  {
    name: "invoices",
    minRole: "organizer",
    doc: invoicesDoc,
    tools: ["list_invoices", "get_invoice", "list_open_invoices"],
  },
  {
    name: "receipts",
    minRole: "organizer",
    doc: receiptsDoc,
    tools: ["list_missing_receipts", "get_receipt_status"],
  },
  {
    name: "transactions",
    minRole: "organizer",
    doc: transactionsDoc,
    tools: ["list_transactions", "get_transaction", "find_transactions"],
  },
  {
    name: "transfers",
    minRole: "organizer",
    doc: transfersDoc,
    tools: ["list_transfers", "get_transfer"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, FINANCE_SKILL_DEFINITIONS),
  },
});
