import { Events } from "discord.js";
import type { Embed } from "discord.js";

type Embeds = readonly Pick<Embed, "url">[];
interface PreviewMessage {
  readonly id: string;
  readonly embeds: Embeds;
}

type UpdateListener = (before: PreviewMessage, after: PreviewMessage) => void;
interface MessageUpdates {
  readonly on: (event: "messageUpdate", listener: UpdateListener) => void;
  readonly off: (event: "messageUpdate", listener: UpdateListener) => void;
}

/** One gateway listener for all pending replies, removed when the last wait ends. */
export function createEmbedWaiter(updates: MessageUpdates, timeoutMs = 7_000) {
  const pending = new Map<string, Set<(embeds: Embeds) => void>>();
  const onUpdate: UpdateListener = (_before, after) => {
    for (const check of pending.get(after.id) ?? []) check(after.embeds);
  };

  return async (
    reply: PreviewMessage & { readonly fetch: () => Promise<{ readonly embeds: Embeds }> },
    expectedUrls: readonly string[],
    cachedEmbeds: () => Embeds | undefined,
  ): Promise<boolean> => {
    const complete = (embeds: Embeds) =>
      expectedUrls.every((url) => embeds.some((candidate) => candidate.url === url));
    if (complete(reply.embeds) || complete(cachedEmbeds() ?? [])) return true;

    const { promise, resolve } = Promise.withResolvers<boolean>();
    let observed = reply.embeds;
    const check = (embeds: Embeds) => {
      observed = embeds;
      if (complete(embeds)) resolve(true);
    };
    if (pending.size === 0) updates.on(Events.MessageUpdate, onUpdate);
    const listeners = pending.get(reply.id) ?? new Set();
    listeners.add(check);
    pending.set(reply.id, listeners);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    try {
      // Catch updates that arrived before the REST send returned its message.
      check(cachedEmbeds() ?? reply.embeds);
      if (await promise) return true;
      // A reconnect or uncached message can miss an update. One REST read at
      // the deadline preserves the fallback without polling healthy unfurls.
      return complete((await reply.fetch()).embeds) || complete(observed);
    } finally {
      clearTimeout(timer);
      listeners.delete(check);
      if (listeners.size === 0) pending.delete(reply.id);
      if (pending.size === 0) updates.off(Events.MessageUpdate, onUpdate);
    }
  };
}
