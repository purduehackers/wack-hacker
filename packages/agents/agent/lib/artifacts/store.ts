import { createHash } from "node:crypto";

import { agentArtifacts, getDb } from "@repo/shared/db";
import { put, get } from "@vercel/blob";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { env, tursoConfig } from "../../env.ts";
import { artifactIdSchema } from "./schema.ts";
export { artifactIdSchema } from "./schema.ts";
export const MAX_ARTIFACT_BYTES = 8_000_000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;
export type ArtifactRow = typeof agentArtifacts.$inferSelect;

export interface ArtifactScope {
  readonly ownerId: string;
  readonly scopeId: string;
  readonly dispatchId: string;
}

export function artifactScope(ctx: ToolContext): ArtifactScope {
  const auth = ctx.session.auth.current;
  const ownerId = z.string().min(1).parse(auth?.principalId);
  const scopeId = z
    .string()
    .min(1)
    .parse(
      auth?.attributes.renderChannelId ??
        auth?.attributes.threadId ??
        auth?.attributes.channelId ??
        ctx.session.id,
    );
  const dispatchId = z
    .string()
    .min(1)
    .parse(auth?.attributes.discordDispatchId ?? ctx.session.id);
  return { ownerId, scopeId, dispatchId };
}

function privateToken(): string {
  if (!env.ARTIFACT_READ_WRITE_TOKEN) throw new Error("Private artifact storage is not configured");
  return env.ARTIFACT_READ_WRITE_TOKEN;
}

export interface ArtifactInput {
  readonly key: string;
  readonly kind: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly body: Buffer;
  readonly metadata: z.output<ReturnType<typeof z.json>>;
  readonly visible?: boolean;
  readonly retained?: boolean;
}

export async function saveArtifact(
  scope: ArtifactScope,
  input: ArtifactInput,
): Promise<ArtifactRow> {
  if (input.body.length > MAX_ARTIFACT_BYTES)
    throw new Error("Artifact exceeds the 8 MB delivery limit");
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  const id = createHash("sha256")
    .update(
      `${scope.ownerId}:${scope.scopeId}:${scope.dispatchId}:${input.key}:${input.filename}:${sha256}`,
    )
    .digest("hex")
    .slice(0, 32);
  const db = getDb(tursoConfig());
  const previous = (await db.select().from(agentArtifacts).where(eq(agentArtifacts.id, id)))[0];
  if (previous !== undefined) return previous;
  const pathname = `artifacts/${id}/${input.filename}`;
  await put(pathname, input.body, {
    access: "private",
    token: privateToken(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: input.mediaType,
  });
  const createdAt = new Date().toISOString();
  await db
    .insert(agentArtifacts)
    .values({
      id,
      ...scope,
      kind: input.kind,
      filename: input.filename,
      mediaType: input.mediaType,
      bytes: input.body.length,
      sha256,
      pathname,
      metadata: JSON.stringify(input.metadata),
      visible: input.visible ?? false,
      retained: input.retained ?? false,
      createdAt,
      expiresAt: new Date(Date.now() + RETENTION_MS).toISOString(),
    })
    .onConflictDoNothing();
  const saved = (await db.select().from(agentArtifacts).where(eq(agentArtifacts.id, id)))[0];
  if (saved === undefined) throw new Error("Artifact metadata was not persisted");
  return saved;
}

export async function artifactForScope(
  id: string,
  scope: Pick<ArtifactScope, "ownerId" | "scopeId">,
) {
  artifactIdSchema.parse(id);
  const row = (
    await getDb(tursoConfig())
      .select()
      .from(agentArtifacts)
      .where(
        and(
          eq(agentArtifacts.id, id),
          eq(agentArtifacts.ownerId, scope.ownerId),
          eq(agentArtifacts.scopeId, scope.scopeId),
        ),
      )
  )[0];
  if (
    row === undefined ||
    (!row.retained && row.publicUrl === null && row.expiresAt < new Date().toISOString())
  )
    throw new Error("Artifact is missing, expired, or belongs to another requester/channel");
  return row;
}

export async function artifactBytes(row: ArtifactRow): Promise<Buffer> {
  const response = await get(row.pathname, { access: "private", token: privateToken() });
  if (response?.statusCode !== 200 || response.stream === undefined)
    throw new Error("Artifact body is unavailable");
  const body = Buffer.from(await new Response(response.stream).arrayBuffer());
  if (body.length !== row.bytes || createHash("sha256").update(body).digest("hex") !== row.sha256)
    throw new Error("Artifact integrity check failed");
  return body;
}

export async function deliveryArtifacts(dispatchId: string) {
  const records = await getDb(tursoConfig())
    .select()
    .from(agentArtifacts)
    .where(
      and(
        eq(agentArtifacts.dispatchId, dispatchId),
        eq(agentArtifacts.visible, true),
        gt(agentArtifacts.expiresAt, new Date().toISOString()),
      ),
    )
    .orderBy(agentArtifacts.createdAt);
  if (records.length > 10)
    throw new Error(
      "This reply has more than 10 attachments; split the report into multiple replies",
    );
  return records.map((row) => {
    const metadata: unknown = JSON.parse(row.metadata);
    const alt = z.object({ alt: z.string().max(1000) }).safeParse(metadata).data?.alt;
    return {
      id: row.id,
      filename: row.filename,
      mediaType: row.mediaType,
      bytes: row.bytes,
      sha256: row.sha256,
      ...(alt === undefined ? {} : { description: alt }),
    };
  });
}

/** Publish a complete chart's exports together, within the Discord reply budget. */
export async function attachArtifacts(ids: readonly string[], scope: ArtifactScope) {
  await getDb(tursoConfig()).transaction(async (tx) => {
    const records = await tx
      .select()
      .from(agentArtifacts)
      .where(eq(agentArtifacts.dispatchId, scope.dispatchId));
    const requested = records.filter(
      (row) =>
        ids.includes(row.id) && row.ownerId === scope.ownerId && row.scopeId === scope.scopeId,
    );
    if (requested.length !== ids.length) throw new Error("Chart exports are not complete");
    const visible = records.filter((row) => row.visible || ids.includes(row.id));
    if (visible.length > 10 || visible.reduce((sum, row) => sum + row.bytes, 0) > 24_000_000)
      throw new Error("Reply exceeds 10 attachments or 24 MB; request fewer charts");
    await tx
      .update(agentArtifacts)
      .set({ visible: true })
      .where(inArray(agentArtifacts.id, [...ids]));
  });
}

/** Publishing a selected artifact is an explicit write; public files remain pinned. */
export async function publishArtifact(id: string, scope: ArtifactScope) {
  const row = await artifactForScope(id, scope);
  if (row.publicUrl !== null) return { id, url: row.publicUrl };
  const token = env.ARTIFACT_PUBLIC_READ_WRITE_TOKEN;
  if (!token) throw new Error("Public media storage is not configured");
  const body = await artifactBytes(row);
  const publicBlob = await put(`media/${row.id}/${row.filename}`, body, {
    access: "public",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: row.mediaType,
  });
  await getDb(tursoConfig())
    .update(agentArtifacts)
    .set({ publicUrl: publicBlob.url, retained: true })
    .where(eq(agentArtifacts.id, id));
  return { id, url: publicBlob.url };
}
