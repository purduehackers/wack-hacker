import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "../../cloudflare/lib/client.ts";
import { notion } from "./client.ts";
import {
  COMPANIES_DATA_SOURCE_ID,
  CONTACTS_DATA_SOURCE_ID,
  OUTREACH_FROM_EMAIL,
  OUTREACH_REPLY_TO_EMAIL,
} from "./constants.ts";

/**
 * Value this tool reports for a Notion property that is unset or holds a
 * different property type. The model has to see "read it, there was nothing
 * there" rather than a missing key, so the JSON output carries an explicit
 * null. One named sentinel keeps the rest of this module under the no-null
 * rule.
 */
// oxlint-disable-next-line unicorn/no-null -- serialized tool output distinguishes an empty property from an absent key
const ABSENT = null;

export const get_email_status = defineTool({
  description: `Read the outreach tracking properties off a Company or Contact page. Returns Last Outreach ID, Outreach Status, Outreach Last Event At, Do Not Contact. \`send_outreach_email\` writes these when it sends.`,
  access: { risk: "read" },
  input: z.strictObject({
    page_id: z.string(),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.retrieve({ page_id });
    if (!("properties" in page)) return { id: page.id };
    const props = page.properties;
    type PageProperty = PageObjectResponse["properties"][string];
    const readRich = (property: PageProperty | undefined) => {
      if (property?.type !== "rich_text") return ABSENT;
      return property.rich_text.map((item) => item.plain_text).join("");
    };
    const readSelect = (property: PageProperty | undefined) => {
      if (property?.type !== "select") return ABSENT;
      return property.select?.name ?? ABSENT;
    };
    const readDate = (property: PageProperty | undefined) => {
      if (property?.type !== "date") return ABSENT;
      return property.date?.start ?? ABSENT;
    };
    const readCheckbox = (property: PageProperty | undefined) => {
      if (property?.type !== "checkbox") return ABSENT;
      return property.checkbox;
    };
    return {
      id: page.id,
      last_outreach_id: readRich(props["Last Outreach ID"]),
      outreach_status: readSelect(props["Outreach Status"]),
      outreach_last_event_at: readDate(props["Outreach Last Event At"]),
      do_not_contact: readCheckbox(props["Do Not Contact"]),
    };
  },
});

/**
 * Records a completed send on the CRM row.
 *
 * Kept private rather than exposed as its own tool: the only correct time to
 * write these three properties is immediately after a send, and the previous
 * implementation's separate `set_company_last_outreach` / `set_contact_last_outreach`
 * tools let the model claim an email had been sent without one leaving the building.
 */
async function recordSend(pageId: string, messageId: string, sentAt: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Last Outreach ID": { rich_text: [{ text: { content: messageId } }] },
      "Outreach Status": { select: { name: "Sent" } },
      "Outreach Last Event At": { date: { start: sentAt } },
    },
  });
}

/**
 * Refuses a send that must not happen.
 *
 * Two independent checks, both fail-closed. The page must belong to the CRM data
 * source the caller named, so a mistyped `target` cannot email a row from an
 * unrelated database; and `Do Not Contact` is honored, which is the only thing
 * standing between this tool and mailing someone who asked not to be contacted.
 *
 * Returns the reason a send was refused, or undefined when it may proceed.
 */
async function refusalReason(
  pageId: string,
  target: "company" | "contact",
): Promise<string | undefined> {
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!("properties" in page)) return "could not read the target page's properties";

  const expected = target === "company" ? COMPANIES_DATA_SOURCE_ID : CONTACTS_DATA_SOURCE_ID;
  const parent = page.parent;
  const actual =
    parent.type === "data_source_id"
      ? parent.data_source_id
      : parent.type === "database_id"
        ? parent.database_id
        : undefined;
  if (actual !== undefined && actual !== expected) {
    return `page ${pageId} does not belong to the ${target} data source`;
  }

  const doNotContact = page.properties["Do Not Contact"];
  if (doNotContact?.type === "checkbox" && doNotContact.checkbox) {
    return "Do Not Contact is set on this page";
  }
  return undefined;
}

export const send_outreach_email = defineTool({
  description: `Send one outreach email to one recipient and record the message id on the target Notion row ("Last Outreach ID", "Outreach Status" = Sent, "Outreach Last Event At"). Refuses to send when the row has "Do Not Contact" checked or does not belong to the named CRM data source. Sends from ${OUTREACH_FROM_EMAIL} with ${OUTREACH_REPLY_TO_EMAIL} as Reply-To. For mass campaigns use the broadcasts skill instead.`,
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    target: z.literal(["company", "contact"]).describe("Which CRM data source owns the page"),
    page_id: z.string().describe("Notion page id of the Company or Contact row"),
    to: z.email().describe("Recipient address — verify it with verify_email first"),
    subject: z.string().min(1),
    text: z.string().min(1).describe("Plain-text body"),
    html: z.string().min(1).optional().describe("Optional HTML body"),
  }),
  execute: async ({ target, page_id, to, subject, text, html }) => {
    const refusal = await refusalReason(page_id, target);
    if (refusal !== undefined) return { sent: false, refused: refusal };

    const result = await cloudflare().emailSending.send({
      account_id: accountId(),
      from: OUTREACH_FROM_EMAIL,
      reply_to: OUTREACH_REPLY_TO_EMAIL,
      to,
      subject,
      text,
      ...(html === undefined ? {} : { html }),
    });

    // A permanent bounce is reported in the success body rather than as an
    // error, so an address Cloudflare already knows is dead would otherwise be
    // recorded as a successful send.
    if (result.permanent_bounces.includes(to)) {
      return { sent: false, refused: `${to} permanently bounced`, message_id: result.message_id };
    }

    const sentAt = new Date().toISOString();
    await recordSend(page_id, result.message_id, sentAt);
    return {
      sent: true,
      message_id: result.message_id,
      queued: result.queued.includes(to),
      target,
      page_id,
      sent_at: sentAt,
    };
  },
});
