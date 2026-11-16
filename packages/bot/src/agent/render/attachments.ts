import { createHash } from "node:crypto";

import type { RenderArtifact } from "@repo/shared/wire";
import type { Client, RESTPatchAPIChannelMessageJSONBody } from "discord.js";
import { z } from "zod";

const messageSchema = z.object({
  attachments: z.array(z.object({ id: z.string(), filename: z.string() })),
});
export type ArtifactLoader = (artifact: RenderArtifact) => Promise<Buffer>;

/** PATCH a known message; a crash after upload is recovered by reading its filenames. */
export interface AttachmentSync {
  readonly rest: Pick<Client["rest"], "get" | "patch">;
  readonly channelId: string;
  readonly messageId: string;
  readonly artifacts: readonly RenderArtifact[];
  readonly load: ArtifactLoader;
  readonly beforeWrite: () => Promise<boolean>;
}
export async function synchronizeAttachments({
  rest,
  channelId,
  messageId,
  artifacts,
  load,
  beforeWrite,
}: AttachmentSync) {
  if (artifacts.reduce((total, artifact) => total + artifact.bytes, 0) > 24_000_000)
    throw new Error("Reply attachments exceed 24 MB");
  const route = `/channels/${channelId}/messages/${messageId}` as const;
  const current = messageSchema.parse(
    await rest.get(route, { signal: AbortSignal.timeout(20_000) }),
  );
  const names = artifacts.map((artifact) => `wack-${artifact.id}-${artifact.filename}`);
  if (
    current.attachments.length === names.length &&
    names.every((filename) =>
      current.attachments.some((attachment) => attachment.filename === filename),
    )
  )
    return current.attachments.map((attachment) => attachment.id);
  const desired: NonNullable<RESTPatchAPIChannelMessageJSONBody["attachments"]> = [];
  const files: Array<{ name: string; data: Buffer; contentType: string }> = [];
  for (const descriptor of artifacts) {
    const filename = `wack-${descriptor.id}-${descriptor.filename}`;
    const existing = current.attachments.find((attachment) => attachment.filename === filename);
    if (existing) {
      desired.push({ id: existing.id, filename });
      continue;
    }
    const body = await load(descriptor);
    if (
      body.length !== descriptor.bytes ||
      createHash("sha256").update(body).digest("hex") !== descriptor.sha256
    )
      throw new Error("Downloaded artifact failed integrity verification");
    desired.push({
      id: String(files.length),
      filename,
      ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
    });
    files.push({ name: filename, data: body, contentType: descriptor.mediaType });
  }
  if (!(await beforeWrite())) throw new Error("Render lease lost before attachment upload");
  const updated = messageSchema.parse(
    await rest.patch(route, {
      body: { attachments: desired },
      files,
      signal: AbortSignal.timeout(30_000),
    }),
  );
  return updated.attachments.map((attachment) => attachment.id);
}
