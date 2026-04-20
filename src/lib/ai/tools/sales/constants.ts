/**
 * Workspace-fixed identifiers for the Purdue Hackers CRM in Notion.
 * These are the same in every deployment environment and are not secrets,
 * so they live here instead of in env. The values were discovered via the
 * Notion MCP and belong to the `CRM` database's three sibling data sources.
 */
export const COMPANIES_DATA_SOURCE_ID = "50e03139-7a46-4877-b2b7-710ff51cc068";
export const CONTACTS_DATA_SOURCE_ID = "8b79755b-242b-4524-961a-d309b080db67";
export const DEALS_DATA_SOURCE_ID = "723bf767-d942-4c55-ab11-f759ce39f4da";

/** Verified Resend sending address for cold outreach. */
export const SALES_FROM_EMAIL = "hi@mail.purduehackers.com";

/** Reply-To header — where recipient replies should land. */
export const SALES_REPLY_TO_EMAIL = "phackers@purdue.edu";
