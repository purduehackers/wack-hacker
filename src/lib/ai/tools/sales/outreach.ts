import { tool } from "ai";
import { z } from "zod";

import { notion, resend } from "./client.ts";
import {
  COMPANIES_DATA_SOURCE_ID,
  CONTACTS_DATA_SOURCE_ID,
  SALES_FROM_EMAIL,
  SALES_REPLY_TO_EMAIL,
} from "./constants.ts";

async function writeLastOutreach(pageId: string, emailId: string, sentAt: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Last Outreach ID": { rich_text: [{ text: { content: emailId } }] },
      "Outreach Status": { select: { name: "Sent" } },
      "Outreach Last Event At": { date: { start: sentAt } },
    },
  });
}

/**
 * Verify the Notion page belongs to the expected CRM data source and honors
 * the Do Not Contact flag. Returns null when the send can proceed, or an
 * error string describing why it was blocked.
 */
async function preflight(pageId: string, target: "company" | "contact"): Promise<string | null> {
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!("properties" in page)) return "Could not read target page properties";

  const expectedId = target === "company" ? COMPANIES_DATA_SOURCE_ID : CONTACTS_DATA_SOURCE_ID;
  const parent = (page as { parent?: { data_source_id?: string; database_id?: string } }).parent;
  const actualId = parent?.data_source_id ?? parent?.database_id;
  if (actualId && actualId !== expectedId) {
    return `Page ${pageId} parent data source does not match target="${target}"`;
  }

  const props = page.properties as Record<string, { type?: string; [key: string]: unknown }>;
  const doNotContact = props["Do Not Contact"];
  if (doNotContact?.type === "checkbox" && doNotContact.checkbox) {
    return "Do Not Contact is set on this page";
  }
  return null;
}

// destructive
export const send_outreach_email = tool({
  description: `Send an outreach email via Resend and record the resulting email id on the target Notion page ("Last Outreach ID", "Outreach Status" = Sent). The target page must not have "Do Not Contact" checked. Sends from the fixed SALES_FROM_EMAIL with SALES_REPLY_TO_EMAIL in the Reply-To header.`,
  inputSchema: z.object({
    target: z.enum(["company", "contact"]).describe("Which CRM data source owns the page"),
    page_id: z.string().describe("Notion page id of the Company or Contact row"),
    to: z.email().describe("Recipient email (must already be verified)"),
    subject: z.string(),
    text: z.string().describe("Plain-text body"),
    html: z.string().optional().describe("Optional HTML body"),
  }),
  execute: async ({ target, page_id, to, subject, text, html }) => {
    const block = await preflight(page_id, target);
    if (block) return JSON.stringify({ error: block });

    const result = await resend().emails.send({
      from: SALES_FROM_EMAIL,
      to,
      subject,
      text,
      html,
      replyTo: SALES_REPLY_TO_EMAIL,
    });
    if (result.error) {
      return JSON.stringify({ error: result.error.message, name: result.error.name });
    }
    const emailId = result.data?.id;
    if (!emailId) {
      return JSON.stringify({ error: "Resend returned no email id" });
    }
    const sentAt = new Date().toISOString();
    await writeLastOutreach(page_id, emailId, sentAt);
    return JSON.stringify({ id: emailId, target, page_id, sent_at: sentAt });
  },
});

export const get_email_status = tool({
  description: `Read the outreach tracking properties off a Company or Contact page. Returns Last Outreach ID, Outreach Status, Outreach Last Event At, Do Not Contact. The Resend webhook keeps these authoritative.`,
  inputSchema: z.object({
    page_id: z.string(),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.retrieve({ page_id });
    if (!("properties" in page)) return JSON.stringify({ id: page.id });
    const props = page.properties as Record<string, { type?: string; [key: string]: unknown }>;
    const readRich = (property: { type?: string; [key: string]: unknown } | undefined) => {
      if (!property || property.type !== "rich_text" || !Array.isArray(property.rich_text))
        return null;
      return (property.rich_text as Array<{ plain_text?: string }>)
        .map((t) => t.plain_text ?? "")
        .join("");
    };
    const readSelect = (property: { type?: string; [key: string]: unknown } | undefined) => {
      if (!property || property.type !== "select" || !property.select) return null;
      return (property.select as { name?: string }).name ?? null;
    };
    const readDate = (property: { type?: string; [key: string]: unknown } | undefined) => {
      if (!property || property.type !== "date" || !property.date) return null;
      return (property.date as { start?: string }).start ?? null;
    };
    const readCheckbox = (property: { type?: string; [key: string]: unknown } | undefined) => {
      if (!property || property.type !== "checkbox") return null;
      return property.checkbox as boolean;
    };
    return JSON.stringify({
      id: page.id,
      last_outreach_id: readRich(props["Last Outreach ID"]),
      outreach_status: readSelect(props["Outreach Status"]),
      outreach_last_event_at: readDate(props["Outreach Last Event At"]),
      do_not_contact: readCheckbox(props["Do Not Contact"]),
    });
  },
});
