import { Client } from "@notionhq/client";

import { env } from "../../../../env.ts";

export const notion = new Client({ auth: env.NOTION_TOKEN });

/** Extract plain text from a Notion rich_text array. */
export function richTextToPlain(richText: Array<{ plain_text: string }>) {
  return richText.map((t) => t.plain_text).join("");
}
