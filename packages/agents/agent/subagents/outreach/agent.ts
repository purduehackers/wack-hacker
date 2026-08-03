import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Drive the Notion-based CRM — query Companies, Contacts, and Deals, enrich leads with emails, " +
    "send outreach via Resend, and track send, open, click, and bounce state. Use when: the user " +
    "asks about the CRM, sponsorships, donors, leads, outreach emails, Deals, or sales pipeline " +
    "activity.",
  model: "anthropic/claude-sonnet-5",
});
