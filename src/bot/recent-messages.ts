import type { API } from "@discordjs/core/http-only";

import { log } from "evlog";

import type { RecentMessage } from "@/lib/ai/types";

const MAX_RECENT_MESSAGES = 15;
const REFERENCED_CONTEXT_SIZE = 15;

type RawMessage = Awaited<ReturnType<API["channels"]["getMessage"]>>;

function toRecentMessage(m: RawMessage): RecentMessage {
  return {
    id: m.id,
    author: (m.author as { global_name?: string }).global_name ?? m.author.username,
    content: m.content,
    timestamp: new Date(m.timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

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
    const messages = raw
      .filter((m) => m.content?.trim())
      .reverse()
      .map(toRecentMessage);

    return messages.length > 0 ? messages : undefined;
  } catch (err) {
    log.warn("recent-messages", `Failed to fetch: ${String(err)}`);
    return undefined;
  }
}

/**
 * Fetch the referenced message plus the 14 messages that immediately preceded
 * it, in chronological order. Used when a mention arrives as a reply to older
 * chatter that isn't in the recent-messages tail — gives the model the anchor
 * plus context leading up to it.
 */
export async function fetchReferencedMessageContext(
  discord: API,
  channelId: string,
  referencedMessageId: string,
): Promise<RecentMessage[] | undefined> {
  try {
    const [anchor, priors] = await Promise.all([
      discord.channels.getMessage(channelId, referencedMessageId),
      discord.channels.getMessages(channelId, {
        before: referencedMessageId,
        limit: REFERENCED_CONTEXT_SIZE - 1,
      }),
    ]);

    // Discord returns priors newest-first; chronological = reverse(priors) then anchor.
    const messages = [...priors.toReversed(), anchor]
      .filter((m) => m.content?.trim())
      .map(toRecentMessage);

    return messages.length > 0 ? messages : undefined;
  } catch (err) {
    log.warn("recent-messages", `Failed to fetch referenced context: ${String(err)}`);
    return undefined;
  }
}
