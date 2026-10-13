import { createHash } from "node:crypto";

import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { RESTPostAPIChannelMessageJSONBody } from "discord.js";

import type { RendererDeps, RendererProjection } from "../agent/render/renderer.ts";
import { badgeEmbed } from "./messages.ts";

interface ReplyControls {
  key: string;
  components: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]>;
}

/** Badge answers are sent once, after completion, without exposing streamed tool activity. */
export async function renderBadgeReply(
  deps: RendererDeps,
  state: RendererProjection,
  text: string,
  controls?: ReplyControls,
) {
  if (!text.trim() || (controls?.key && state.hitlRequestKey === controls.key))
    return Result.ok(undefined);
  const embeds = [badgeEmbed(text)];
  const components = controls?.components ?? [];
  const digest = createHash("sha256").update(JSON.stringify({ embeds, components })).digest("hex");
  if (state.anchorContentHash === digest) return Result.ok(undefined);
  if (!(await deps.verifyLease()))
    return Result.err(
      new Transient({ operation: "render badge reply", detail: "Render lease expired." }),
    );
  const nonce = createHash("sha256")
    .update(`${deps.sourceMessageId}:${digest}`)
    .digest("hex")
    .slice(0, 24);
  const posted = await deps.rest.postMessage(deps.channelId, {
    embeds,
    components,
    nonce,
    enforce_nonce: true,
    allowed_mentions: { parse: [] },
  });
  if (Result.isError(posted)) return posted;
  if (controls) {
    state.hitlRequestKey = controls.key;
    state.hitlMessageId = posted.value.id;
  }
  state.anchorMessageId = posted.value.id;
  state.anchorContentHash = digest;
  if (await deps.checkpoint(state)) return Result.ok(undefined);
  return Result.err(
    new Transient({ operation: "save badge reply", detail: "Render lease expired." }),
  );
}
