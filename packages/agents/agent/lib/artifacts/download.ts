import type { ConversationStore } from "@repo/shared/conversations";
import { Result } from "@repo/shared/result";
import { z } from "zod";

import { artifactBytes, artifactForScope, artifactIdSchema } from "./store.ts";

const requestSchema = z.strictObject({ id: artifactIdSchema, dispatchId: z.uuid() });

/** Called only after the channel verifies the bot's ingress credential. */
export async function artifactDownload(
  request: Request,
  store: ConversationStore,
): Promise<Response> {
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "Invalid artifact request" }, { status: 400 });
  const target = await store.renders.target(parsed.data.dispatchId);
  if (Result.isError(target) || target.value === undefined)
    return Response.json({ error: "Unknown delivery" }, { status: 404 });
  try {
    const row = await artifactForScope(parsed.data.id, {
      ownerId: target.value.requesterUserId,
      scopeId: target.value.channelId,
    });
    if (row.dispatchId !== parsed.data.dispatchId || !row.visible)
      return Response.json({ error: "Artifact is not part of this delivery" }, { status: 404 });
    const body = await artifactBytes(row);
    return new Response(body, {
      headers: {
        "Content-Type": row.mediaType,
        "Content-Length": String(body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Artifact unavailable" }, { status: 503 });
  }
}
