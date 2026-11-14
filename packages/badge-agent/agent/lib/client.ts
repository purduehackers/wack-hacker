import { createBadgeClient, type BadgeResponse } from "@purduehackers/badges/client";
import type { BadgeToolName } from "@purduehackers/badges/tools";
import { BADGES_CHANNEL_ID } from "@purduehackers/badges/wire";
import { env } from "@repo/agents/env";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

export function badgeRequest(
  auth: ToolContext["session"]["auth"]["current"],
  path: "status",
): Promise<BadgeResponse<"status">>;
export function badgeRequest(
  auth: ToolContext["session"]["auth"]["current"],
  path: "tool",
  body: { name: BadgeToolName; input: unknown },
): Promise<unknown>;
export async function badgeRequest(
  auth: ToolContext["session"]["auth"]["current"],
  path: "status" | "tool",
  body?: { name: BadgeToolName; input: unknown },
) {
  if (auth?.authenticator !== "discord" || !auth.principalId)
    throw new Error("Use the badge thread in Discord.");
  const attributes = z
    .object({
      channelId: z.literal(BADGES_CHANNEL_ID),
      guildId: z.literal(DISCORD_GUILD_ID),
      threadId: z.string(),
      discordMessageId: z.string(),
      source: z.literal("chat"),
    })
    .parse(auth.attributes);
  if (!env.BADGES_API_URL) throw new Error("Badge service is not configured.");
  const client = createBadgeClient(
    env.BADGES_API_URL,
    env.BADGES_API_SECRET ?? env.AGENT_INGRESS_SECRET,
  );
  const context = {
    threadId: attributes.threadId,
    messageId: attributes.discordMessageId,
    userId: auth.principalId,
  };
  if (path === "status") return client.post(path, context, 90_000);
  if (!body) throw new Error("A badge tool request is required.");
  return client.post(path, { ...context, ...body }, 90_000);
}
