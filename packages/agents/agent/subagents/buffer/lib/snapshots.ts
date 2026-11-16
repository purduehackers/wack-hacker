import { bufferSnapshots, getDb } from "@repo/shared/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { tursoConfig } from "../../../env.ts";
import { allowedOrganizations, executeBuffer } from "./client.ts";

const pageSchema = z.object({
  edges: z.array(z.object({ node: z.record(z.string(), z.json()) })).nullish(),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
});

async function collectPosts(organizationId: string, signal: AbortSignal) {
  const posts: Array<Record<string, z.JSONType>> = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await executeBuffer(
      "posts",
      {
        input: {
          organizationId,
          filter: { status: ["sent"] },
          sort: [{ field: "dueAt", direction: "desc" }],
        },
        first: 100,
        ...(after === undefined ? {} : { after }),
      },
      "edges { node { id channelId channelService dueAt metricsUpdatedAt metrics { type unit value } } }",
      "snapshot-read",
      signal,
    );
    if (!result.ok) throw new Error("Buffer snapshot query failed");
    const data = pageSchema.parse(result.data);
    posts.push(...(data.edges ?? []).map((edge) => edge.node));
    if (!data.pageInfo.hasNextPage) return { posts, complete: true };
    if (!data.pageInfo.endCursor || data.pageInfo.endCursor === after)
      throw new Error("Snapshot pagination did not advance");
    after = data.pageInfo.endCursor;
  }
  return { posts, complete: false };
}

/** One observation per UTC day; bounded at 2000 posts and always labels partial collections. */
export async function collectBufferSnapshots(signal: AbortSignal) {
  const db = getDb(tursoConfig());
  for (const organizationId of allowedOrganizations()) {
    const observedAt = new Date().toISOString();
    const id = `${organizationId}:${observedAt.slice(0, 10)}`;
    const previous = (await db.select().from(bufferSnapshots).where(eq(bufferSnapshots.id, id)))[0];
    if (previous?.status === "complete") continue;
    try {
      const result = await collectPosts(organizationId, signal);
      const values = {
        id,
        organizationId,
        observedAt,
        status: result.complete ? "complete" : "partial",
        data: JSON.stringify(result.posts),
      };
      await db
        .insert(bufferSnapshots)
        .values(values)
        .onConflictDoUpdate({ target: bufferSnapshots.id, set: values });
    } catch (cause) {
      await db
        .insert(bufferSnapshots)
        .values({ id, organizationId, observedAt, status: "failed", data: "[]" })
        .onConflictDoNothing();
      throw cause;
    }
  }
}

export async function readBufferSnapshots(
  organizationId: string,
  from: string,
  to: string,
  limit: number,
) {
  if (!allowedOrganizations().includes(organizationId))
    throw new Error("Organization is outside the configured Buffer scope");
  const results = await getDb(tursoConfig())
    .select()
    .from(bufferSnapshots)
    .where(
      and(
        eq(bufferSnapshots.organizationId, organizationId),
        gte(bufferSnapshots.observedAt, from),
        lte(bufferSnapshots.observedAt, to),
      ),
    )
    .orderBy(bufferSnapshots.observedAt)
    .limit(limit + 1);
  const snapshots = results.slice(0, limit).map((row) => ({
    id: row.id,
    observedAt: row.observedAt,
    status: row.status,
    posts: z
      .array(z.record(z.string(), z.json()))
      .parse(JSON.parse(row.data))
      .map((post) => ({ ...post, observedAt: row.observedAt })),
  }));
  return {
    snapshots,
    complete: results.length <= limit && snapshots.every((row) => row.status === "complete"),
  };
}
