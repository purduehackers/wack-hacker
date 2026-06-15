import { describe, expect, it } from "vitest";

import { MessageRenderer } from "@/lib/ai/message-renderer";

import type { SimEvent } from "./types.ts";

import { SimEventBus } from "./event-bus.ts";
import { createFakeCoreAPI } from "./fake-core-api.ts";
import { VirtualGuild } from "./virtual-guild.ts";

function harness() {
  const guild = new VirtualGuild({
    guildId: "g1",
    botUserId: "bot1",
    channels: [{ name: "general" }],
  });
  const bus = new SimEventBus("run1");
  const api = createFakeCoreAPI(guild, bus);
  const channelId = guild.ensureChannel("general").id;
  return { guild, bus, api, channelId };
}

function creates(events: SimEvent[]): Extract<SimEvent, { type: "message.create" }>[] {
  return events.filter(
    (e): e is Extract<SimEvent, { type: "message.create" }> => e.type === "message.create",
  );
}

function edits(events: SimEvent[]): Extract<SimEvent, { type: "message.edit" }>[] {
  return events.filter(
    (e): e is Extract<SimEvent, { type: "message.edit" }> => e.type === "message.edit",
  );
}

describe("createFakeCoreAPI + MessageRenderer", () => {
  it("posts a `> Thinking...` placeholder on init", async () => {
    const { bus, api, channelId } = harness();
    const renderer = new MessageRenderer(api, channelId);
    await renderer.init();

    const created = creates(bus.history());
    expect(created).toHaveLength(1);
    expect(created[0].message.content).toBe("> Thinking...");
    expect(created[0].message.authorKind).toBe("bot");
  });

  it("emits an immediate edit on the first streamed text (throttle bypassed)", async () => {
    const { bus, api, channelId } = harness();
    const renderer = new MessageRenderer(api, channelId);
    await renderer.init();
    const placeholderId = creates(bus.history())[0].message.id;

    await renderer.appendText("Hello world");

    const edited = edits(bus.history());
    expect(edited).toHaveLength(1);
    expect(edited[0].messageId).toBe(placeholderId);
    expect(edited[0].content).toBe("Hello world");
  });

  it("renders the footer into the finalized message", async () => {
    const { bus, api, channelId } = harness();
    const renderer = new MessageRenderer(api, channelId);
    await renderer.init();
    await renderer.appendText("Done.");

    await renderer.finalize({ elapsedMs: 3200, totalTokens: 1423, toolCallCount: 4, stepCount: 2 });

    const last = edits(bus.history()).at(-1)!;
    expect(last.content).toContain("Done.");
    expect(last.content).toContain("-# ");
    expect(last.content).toContain("3.2s");
    expect(last.content).toContain("1,423 tokens");
    expect(last.content).toContain("4 tool calls");
  });

  it("splits an over-long reply into overflow messages", async () => {
    const { bus, api, channelId } = harness();
    const renderer = new MessageRenderer(api, channelId);
    await renderer.init();
    await renderer.appendText("word ".repeat(900)); // ~4500 chars > 1900 cap

    await renderer.finalize({ elapsedMs: 1000, totalTokens: 10, toolCallCount: 0, stepCount: 1 });

    // init create + at least one overflow create; primary edited with chunk[0].
    const created = creates(bus.history());
    const edited = edits(bus.history());
    expect(created.length).toBeGreaterThan(1);
    expect(edited.length).toBeGreaterThanOrEqual(1);
    for (const overflow of created.slice(1)) {
      expect(overflow.message.content.length).toBeLessThanOrEqual(1900);
    }
  });

  it("captures bot reactions through addMessageReaction", async () => {
    const { bus, api, guild, channelId } = harness();
    const message = guild.createMessage(channelId, {
      authorId: "u1",
      authorKind: "user",
      content: "hi",
    });
    await api.channels.addMessageReaction(channelId, message.id, "👍");

    const reaction = bus.history().find((e) => e.type === "reaction.add");
    expect(reaction).toBeDefined();
    expect(guild.getMessage(channelId, message.id)?.reactions[0]).toMatchObject({
      emoji: "👍",
      count: 1,
    });
  });
});
