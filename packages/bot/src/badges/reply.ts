import { createHash } from "node:crypto";

import { designerText } from "@purduehackers/badges/presentation";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { RenderIntent } from "@repo/shared/wire";
import { MessageFlags } from "discord.js";

import { renderHitl } from "../agent/hitl/components.ts";
import type { RendererDeps, RendererProjection } from "../agent/render/renderer.ts";

/** Badge answers are sent once, after completion, without exposing streamed tool activity. */
export async function renderBadgeReply(
  deps: RendererDeps,
  state: RendererProjection,
  intent: RenderIntent,
) {
  const hitl = intent.phase === "streaming" ? renderHitl(intent) : undefined;
  const request = hitl?.key
    ? { key: `${hitl.key}:${intent.revision}`, components: hitl.components }
    : undefined;
  let text =
    intent.phase === "failed"
      ? "I couldn’t finish that reply. Mention me again to retry."
      : intent.text;
  if (request)
    text = intent.inputRequests?.[0]?.prompt ?? "Connect the requested account to continue.";
  if (!text.trim() || (request && state.hitlRequestKey === request.key))
    return Result.ok(undefined);
  const content = designerText(text);
  const components = request?.components ?? [];
  const hash = createHash("sha256").update(JSON.stringify({ content, components }));
  const digest = hash.copy().digest("base64url").slice(0, 16);
  if (state.anchorContentHash === digest) return Result.ok(undefined);
  if (!(await deps.verifyLease()))
    return Result.err(
      new Transient({ operation: "render badge reply", detail: "Render lease expired." }),
    );
  const nonce = createHash("sha256")
    .update(`${deps.sourceMessageId}:${hash.digest("hex")}`)
    .digest("hex")
    .slice(0, 24);
  const posted = await deps.rest.postMessage(deps.channelId, {
    content,
    components,
    flags: MessageFlags.SuppressEmbeds,
    nonce,
    enforce_nonce: true,
    allowed_mentions: { parse: [] },
  });
  if (Result.isError(posted)) return posted;
  if (request) {
    state.hitlRequestKey = request.key;
    state.hitlMessageId = posted.value.id;
  }
  state.anchorMessageId = posted.value.id;
  state.anchorContentHash = digest;
  if (await deps.checkpoint(state)) return Result.ok(undefined);
  return Result.err(
    new Transient({ operation: "save badge reply", detail: "Render lease expired." }),
  );
}
