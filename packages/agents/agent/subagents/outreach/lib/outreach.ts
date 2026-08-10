import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { notion } from "./client.ts";

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
  description: `Read the outreach tracking properties off a Company or Contact page. Returns Last Outreach ID, Outreach Status, Outreach Last Event At, Do Not Contact. The Resend webhook keeps these authoritative.`,
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
