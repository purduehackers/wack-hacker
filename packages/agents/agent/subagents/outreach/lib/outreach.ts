/* oxlint-disable unicorn/no-null -- Notion outreach projections use null to represent external fields with no value. */
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";

export const get_email_status = defineTool({
  description: `Read the outreach tracking properties off a Company or Contact page. Returns Last Outreach ID, Outreach Status, Outreach Last Event At, Do Not Contact. The Resend webhook keeps these authoritative.`,
  access: { risk: "read" },
  input: z.object({
    page_id: z.string(),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.retrieve({ page_id });
    if (!("properties" in page)) return { id: page.id };
    const props = page.properties;
    type PageProperty = PageObjectResponse["properties"][string];
    const readRich = (property: PageProperty | undefined) => {
      if (property?.type !== "rich_text") return null;
      return property.rich_text.map((item) => item.plain_text).join("");
    };
    const readSelect = (property: PageProperty | undefined) => {
      if (property?.type !== "select") return null;
      return property.select?.name ?? null;
    };
    const readDate = (property: PageProperty | undefined) => {
      if (property?.type !== "date") return null;
      return property.date?.start ?? null;
    };
    const readCheckbox = (property: PageProperty | undefined) => {
      if (property?.type !== "checkbox") return null;
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
