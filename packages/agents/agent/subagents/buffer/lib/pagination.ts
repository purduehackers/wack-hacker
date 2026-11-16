import { z } from "zod";

import type { BufferResult } from "./results.ts";

const pageSchema = z.object({
  edges: z.array(z.json()).nullish(),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
});

export async function paginateBuffer(
  args: Readonly<Record<string, z.JSONType>>,
  maxPages: number,
  fetchPage: (variables: Readonly<Record<string, z.JSONType>>) => Promise<BufferResult>,
) {
  let variables = args;
  const pages: BufferResult[] = [];
  const visited = new Set<string>();
  for (let index = 0; index < maxPages; index += 1) {
    const result = await fetchPage(variables);
    pages.push(result);
    const segment = pageSchema.safeParse(result.data);
    if (!result.ok || !segment.success || !segment.data.pageInfo.hasNextPage) break;
    const cursor = segment.data.pageInfo.endCursor;
    if (!cursor || cursor === variables.after || visited.has(cursor))
      throw new Error("Buffer pagination did not advance");
    visited.add(cursor);
    variables = { ...args, after: cursor };
  }
  const last = pages.at(-1);
  if (last === undefined) throw new Error("Buffer returned no pages");
  const tail = pageSchema.safeParse(last.data);
  const complete = last.ok && (!tail.success || !tail.data.pageInfo.hasNextPage);
  return { ok: pages.every((segment) => segment.ok), operation: last.operation, pages, complete };
}
