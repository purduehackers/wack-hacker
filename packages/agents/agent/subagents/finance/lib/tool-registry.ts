import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import * as m_base from "./base.ts";
import * as m_card_charges from "./card-charges.ts";
import * as m_donations from "./donations.ts";
import * as m_invoices from "./invoices.ts";
import * as m_receipts from "./receipts.ts";
import * as m_transactions from "./transactions.ts";
import * as m_transfers from "./transfers.ts";

export const FINANCE_TOOLS = {
  donation_totals: m_donations.donation_totals,
  find_transactions: m_transactions.find_transactions,
  get_balance: m_base.get_balance,
  get_donation: m_donations.get_donation,
  get_invoice: m_invoices.get_invoice,
  get_organization: m_base.get_organization,
  get_receipt_status: m_receipts.get_receipt_status,
  get_transaction: m_transactions.get_transaction,
  get_transfer: m_transfers.get_transfer,
  list_card_charges: m_card_charges.list_card_charges,
  list_donations: m_donations.list_donations,
  list_invoices: m_invoices.list_invoices,
  list_missing_receipts: m_receipts.list_missing_receipts,
  list_open_invoices: m_invoices.list_open_invoices,
  list_transactions: m_transactions.list_transactions,
  list_transfers: m_transfers.list_transfers,
} as const satisfies Record<string, DomainToolSpec>;

export type FinanceToolName = keyof typeof FINANCE_TOOLS;
