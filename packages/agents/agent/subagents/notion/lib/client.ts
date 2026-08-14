import { Client } from "@notionhq/client";
import type {
  GetDatabaseResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";

import { env } from "../../../env.ts";

export const notion = new Client(env.NOTION_TOKEN === undefined ? {} : { auth: env.NOTION_TOKEN });

/** Extract plain text from a Notion rich_text array. */
export function richTextToPlain(richText: RichTextItemResponse[]) {
  return richText.map((t) => t.plain_text).join("");
}

/**
 * The first data-source child behind a database container — the queryable
 * half of a v5 database. Throws when Notion returns a partial response or a
 * database with no data source, because no query can proceed without one.
 */
export function firstDataSourceId(database: GetDatabaseResponse): string {
  if (!("data_sources" in database)) {
    throw new Error(`Notion returned a partial database response for ${database.id}`);
  }
  const first = database.data_sources[0];
  if (first === undefined) throw new Error(`Notion database ${database.id} has no data source`);
  return first.id;
}

/** Resolve the v5 data-source child behind a database container. */
export async function resolveDataSourceId(databaseId: string): Promise<string> {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  return firstDataSourceId(database);
}
