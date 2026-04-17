import type { API } from "@discordjs/core/http-only";

import { log } from "evlog";

import type { RecentMessage, SerializedAgentContext } from "@/lib/ai/types";
import type { MessageCreatePacketType } from "@/lib/protocol/types";

import { AgentContext } from "@/lib/ai/context";

const MAX_RECENT_MESSAGES = 15;

export async function fetchRecentMessages(
  discord: API,
  channelId: string,
  beforeMessageId: string,
): Promise<RecentMessage[] | undefined> {
  try {
    const raw = await discord.channels.getMessages(channelId, {
      before: beforeMessageId,
      limit: MAX_RECENT_MESSAGES,
    });

    // Discord returns newest-first; keep chronological order
    const messages: RecentMessage[] = raw
      .filter((m) => m.content?.trim())
      .reverse()
      .map((m) => ({
        author: (m.author as { global_name?: string }).global_name ?? m.author.username,
        content: m.content,
        timestamp: new Date(m.timestamp).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      }));

    return messages.length > 0 ? messages : undefined;
  } catch (err) {
    log.warn("chat-context", `Failed to fetch recent messages: ${String(err)}`);
    return undefined;
  }
}

/**
 * Build a fresh agent context for a single turn, reflecting where the bot's
 * response will be delivered. Pass `threadOverride` when a new thread was just
 * created for this mention — the packet still describes the parent channel, so
 * we synthesize the thread fields explicitly.
 */
export async function buildTurnContext(
  discord: API,
  packet: MessageCreatePacketType,
  threadOverride?: { id: string; name: string },
): Promise<SerializedAgentContext> {
  const { data } = packet;
  // Fetch from `data.channel.id`: for in-thread follow-ups this IS the thread;
  // for a fresh mention in a channel this is the parent channel (the new thread
  // would be empty at this point anyway).
  const recentMessages = await fetchRecentMessages(discord, data.channel.id, data.id);
  const base = AgentContext.fromPacket(packet).toJSON();

  if (threadOverride) {
    return {
      ...base,
      channel: threadOverride,
      thread: {
        id: threadOverride.id,
        name: threadOverride.name,
        parentChannel: data.channel,
      },
      recentMessages,
    };
  }

  return { ...base, recentMessages };
}
