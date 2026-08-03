import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Look up Hack Club Bank balances, transactions, donations, invoices, card charges, and " +
    "transfers for Purdue Hackers. Use when: the user asks about money, budget, balance, " +
    "donations, sponsor invoices, card spend, microgrant spend, receipts, or finances.",
  model: "anthropic/claude-sonnet-5",
});
