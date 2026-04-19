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
    // Attachment-only / sticker messages arrive with empty content. Render a
    // placeholder so callers that include such messages (e.g. the anchor of a
    // reply-context fetch) produce a line the model can see, rather than a
    // dangling `author:` with nothing after it.
    content: m.content?.trim() ? m.content : "(no text content)",
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

    // Priors come newest-first; reverse for chronological order and drop
    // empty-content entries. The anchor is always kept as the last element —
    // even if it's attachment-only — so "last item = reply target" holds
    // and the model can see what was being replied to.
    const chronologicalPriors = priors.toReversed().filter((m) => m.content?.trim());
    return [...chronologicalPriors, anchor].map(toRecentMessage);
  } catch (err) {
    log.warn("recent-messages", `Failed to fetch referenced context: ${String(err)}`);
    return undefined;
  }
}
