/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and the pair drifts the moment they live in
 * different files. `tool_defs/` mirrors the skill list, and
 * `check:capabilities` fails if it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 *
 * `list_transactions` and `get_transaction` are base tools that the
 * `transactions` skill also lists, so their definitions sit in `tool_defs/base/`
 * — the placement follows the stronger claim, which is that they are reachable
 * without loading anything.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import cardChargesDoc from "./skill_defs/card-charges.md" with { type: "text" };
import donationsDoc from "./skill_defs/donations.md" with { type: "text" };
import invoicesDoc from "./skill_defs/invoices.md" with { type: "text" };
import receiptsDoc from "./skill_defs/receipts.md" with { type: "text" };
import transactionsDoc from "./skill_defs/transactions.md" with { type: "text" };
import transfersDoc from "./skill_defs/transfers.md" with { type: "text" };
import { get_balance } from "./tool_defs/base/get_balance.ts";
import { get_organization } from "./tool_defs/base/get_organization.ts";
import { get_transaction } from "./tool_defs/base/get_transaction.ts";
import { list_transactions } from "./tool_defs/base/list_transactions.ts";
import { list_card_charges } from "./tool_defs/card-charges/list_card_charges.ts";
import { donation_totals } from "./tool_defs/donations/donation_totals.ts";
import { get_donation } from "./tool_defs/donations/get_donation.ts";
import { list_donations } from "./tool_defs/donations/list_donations.ts";
import { get_invoice } from "./tool_defs/invoices/get_invoice.ts";
import { list_invoices } from "./tool_defs/invoices/list_invoices.ts";
import { list_open_invoices } from "./tool_defs/invoices/list_open_invoices.ts";
import { get_receipt_status } from "./tool_defs/receipts/get_receipt_status.ts";
import { list_missing_receipts } from "./tool_defs/receipts/list_missing_receipts.ts";
import { find_transactions } from "./tool_defs/transactions/find_transactions.ts";
import { get_transfer } from "./tool_defs/transfers/get_transfer.ts";
import { list_transfers } from "./tool_defs/transfers/list_transfers.ts";

export const FINANCE_TOOLS = {
  donation_totals,
  find_transactions,
  get_balance,
  get_donation,
  get_invoice,
  get_organization,
  get_receipt_status,
  get_transaction,
  get_transfer,
  list_card_charges,
  list_donations,
  list_invoices,
  list_missing_receipts,
  list_open_invoices,
  list_transactions,
  list_transfers,
} as const satisfies Record<string, DomainToolSpec>;

export type FinanceToolName = keyof typeof FINANCE_TOOLS;

export const FINANCE_BASE_TOOL_NAMES = [
  "get_organization",
  "get_balance",
  "list_transactions",
  "get_transaction",
] as const;

export const FINANCE_SKILLS = [
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
