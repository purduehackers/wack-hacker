import type {
  CreatePageResponse,
  GetPageResponse,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints";

/**
 * Workspace-fixed identifiers for the Purdue Hackers CRM in Notion.
 * These are the same in every deployment environment and are not secrets,
 * so they live here instead of in env. The values came from a Notion MCP
 * lookup and belong to the `CRM` database's three sibling data sources.
 */
export const COMPANIES_DATA_SOURCE_ID = "50e03139-7a46-4877-b2b7-710ff51cc068";
export const CONTACTS_DATA_SOURCE_ID = "8b79755b-242b-4524-961a-d309b080db67";
export const DEALS_DATA_SOURCE_ID = "723bf767-d942-4c55-ab11-f759ce39f4da";

/**
 * Verified Cloudflare sending address for 1:1 outreach.
 *
 * The apex is already onboarded for Cloudflare Email Sending, so mail from
 * this address authenticates without any further DNS work. `cf-bounce` carries
 * the MX and SPF records and `cf-bounce._domainkey` the DKIM key.
 */
export const OUTREACH_FROM_EMAIL = "hello@purduehackers.com";

/** Reply-To header — where recipient replies should land. */
export const OUTREACH_REPLY_TO_EMAIL = "phackers@purdue.edu";

/**
 * Value a tool reports when it asked the upstream for a field and the upstream
 * left it empty.
 *
 * The model has to see "it was read and there was nothing there" rather than a
 * missing key, so the JSON output carries an explicit null. One named sentinel
 * keeps every tool file under the no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- serialized tool output distinguishes an empty field from an absent key
export const ABSENT = null;

type CrmPage = QueryDataSourceResponse["results"][number] | GetPageResponse | CreatePageResponse;

/** Compact projection every CRM tool returns for a Notion page. */
export function summarizePage(page: CrmPage) {
  return {
    id: page.id,
    url: "url" in page ? page.url : undefined,
    properties: "properties" in page ? page.properties : undefined,
    created_time: "created_time" in page ? page.created_time : undefined,
    last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
  };
}
