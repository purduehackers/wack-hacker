import type { API } from "@discordjs/core/http-only";

import { log } from "evlog";

import type { RecentMessage } from "@/lib/ai/types";

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
    log.warn("recent-messages", `Failed to fetch: ${String(err)}`);
    return undefined;
  }
}
