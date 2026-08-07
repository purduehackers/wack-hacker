import { describe, expect, test } from "bun:test";

import { Result } from "@repo/shared/result";
import { silentReporter } from "@repo/shared/result/observe";
import { Client } from "discord.js";

import {
  runEventHandlerGroups,
  type Deduplicator,
  type EventContext,
  type EventKind,
  type RoutedEventHandler,
} from "./events.ts";

function handler(
  name: string,
  kind: EventKind,
  handle: () => Promise<void>,
): RoutedEventHandler<string> {
  return {
    name,
    kind,
    dedupKey: (occurrence) => occurrence,
    handle: async () => {
      await handle();
      return Result.ok(undefined);
    },
  };
}

describe("event handler routing", () => {
  test("scopes dedup per handler and completes mentions before message handlers", async () => {
    const timeline: string[] = [];
    const claimed = new Set<string>();
    const dedup: Deduplicator = {
      claim: async (key) => {
        timeline.push(`claim:${key}`);
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    };
    const mentionStarted = Promise.withResolvers<void>();
    const releaseMention = Promise.withResolvers<void>();
    const mention = handler("agent-mention", "mention", async () => {
      timeline.push("mention:start");
      mentionStarted.resolve();
      await releaseMention.promise;
      timeline.push("mention:end");
    });
    const message = handler("chat-indexer", "message", async () => {
      timeline.push("message");
    });
    const context: EventContext = {
      client: new Client<true>({ intents: [] }),
      botUserId: "10000000000000000",
      isBotMention: true,
    };
    const groups = [[mention], [message]];

    const first = runEventHandlerGroups(groups, "message-1", context, {
      dedup,
      reporter: silentReporter,
    });
    await mentionStarted.promise;
    expect(timeline).toEqual(["claim:agent-mention:message-1", "mention:start"]);

    releaseMention.resolve();
    await first;
    expect(timeline).toEqual([
      "claim:agent-mention:message-1",
      "mention:start",
      "mention:end",
      "claim:chat-indexer:message-1",
      "message",
    ]);

    await runEventHandlerGroups(groups, "message-1", context, {
      dedup,
      reporter: silentReporter,
    });
    expect(timeline.slice(5)).toEqual([
      "claim:agent-mention:message-1",
      "claim:chat-indexer:message-1",
    ]);
  });
});
