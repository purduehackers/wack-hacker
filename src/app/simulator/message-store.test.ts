import { describe, expect, it } from "vitest";

import type { SimEvent, SimMessage } from "@/lib/simulator/types";

import { SIM_BOT_ID, SIM_USER_ID } from "@/lib/simulator/constants";

import { initialSimState, reduceSim } from "./message-store.ts";

let seq = 0;

function base(): { seq: number; ts: number; runId: string } {
  return { seq: seq++, ts: Date.now(), runId: "run-1" };
}

function makeMessage(id: string, overrides: Partial<SimMessage> = {}): SimMessage {
  return {
    id,
    channelId: "chan-1",
    authorId: SIM_BOT_ID,
    authorKind: "bot",
    content: "",
    embeds: [],
    components: [],
    reactions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function create(id: string, overrides?: Partial<SimMessage>): SimEvent {
  return { ...base(), type: "message.create", message: makeMessage(id, overrides) };
}

describe("reduceSim", () => {
  it("starts empty and idle", () => {
    const state = initialSimState();
    expect(state.order).toEqual([]);
    expect(state.byId).toEqual({});
    expect(state.status).toBe("idle");
  });

  it("handles create → edit → delete preserving order", () => {
    let state = initialSimState();
    state = reduceSim(state, create("a", { content: "> Thinking..." }));
    state = reduceSim(state, create("b", { content: "second" }));

    expect(state.order).toEqual(["a", "b"]);
    expect(state.byId["a"].content).toBe("> Thinking...");

    state = reduceSim(state, {
      ...base(),
      type: "message.edit",
      messageId: "a",
      channelId: "chan-1",
      content: "Hello world\n\n-# `abc` · 3.2s · 1,423 tokens",
      editedAt: new Date().toISOString(),
    });

    expect(state.byId["a"].content).toBe("Hello world\n\n-# `abc` · 3.2s · 1,423 tokens");
    expect(state.byId["a"].editedAt).toBeDefined();
    // Order unchanged by an edit.
    expect(state.order).toEqual(["a", "b"]);

    state = reduceSim(state, {
      ...base(),
      type: "message.delete",
      messageId: "a",
      channelId: "chan-1",
    });

    expect(state.order).toEqual(["b"]);
    expect(state.byId["a"]).toBeUndefined();
  });

  it("edit only patches provided fields and leaves content intact when omitted", () => {
    let state = initialSimState();
    state = reduceSim(state, create("a", { content: "keep me" }));
    state = reduceSim(state, {
      ...base(),
      type: "message.edit",
      messageId: "a",
      channelId: "chan-1",
      components: [],
      editedAt: new Date().toISOString(),
    });
    expect(state.byId["a"].content).toBe("keep me");
  });

  it("ignores edits and deletes for unknown messages", () => {
    const start = initialSimState();
    const afterEdit = reduceSim(start, {
      ...base(),
      type: "message.edit",
      messageId: "ghost",
      channelId: "chan-1",
      content: "x",
      editedAt: new Date().toISOString(),
    });
    expect(afterEdit).toBe(start);
    const afterDelete = reduceSim(start, {
      ...base(),
      type: "message.delete",
      messageId: "ghost",
      channelId: "chan-1",
    });
    expect(afterDelete).toBe(start);
  });

  it("adds and aggregates reactions immutably", () => {
    let state = initialSimState();
    state = reduceSim(state, create("a"));
    const before = state.byId["a"];

    state = reduceSim(state, {
      ...base(),
      type: "reaction.add",
      messageId: "a",
      channelId: "chan-1",
      emoji: "👍",
      byBot: true,
    });
    expect(state.byId["a"].reactions).toEqual([{ emoji: "👍", count: 1, me: false }]);
    // Did not mutate the previous message object.
    expect(before.reactions).toEqual([]);

    state = reduceSim(state, {
      ...base(),
      type: "reaction.add",
      messageId: "a",
      channelId: "chan-1",
      emoji: "👍",
      byBot: false,
    });
    expect(state.byId["a"].reactions).toEqual([{ emoji: "👍", count: 2, me: true }]);
  });

  it("removes reactions and drops them at zero", () => {
    let state = initialSimState();
    state = reduceSim(state, create("a", { reactions: [{ emoji: "🔥", count: 1, me: true }] }));
    state = reduceSim(state, {
      ...base(),
      type: "reaction.remove",
      messageId: "a",
      channelId: "chan-1",
      emoji: "🔥",
      byBot: false,
    });
    expect(state.byId["a"].reactions).toEqual([]);
  });

  it("tracks run status transitions", () => {
    let state = initialSimState();
    state = reduceSim(state, {
      ...base(),
      type: "run.start",
      turnIndex: 0,
      channelId: "chan-1",
    });
    expect(state.status).toBe("streaming");
    state = reduceSim(state, {
      ...base(),
      type: "run.finish",
      turnIndex: 0,
      discordMessageId: "a",
      model: "claude",
      text: "done",
      usage: {
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
        toolCallCount: 0,
        stepCount: 1,
        toolNames: [],
      },
    });
    expect(state.status).toBe("done");
    state = reduceSim(state, { ...base(), type: "run.error", message: "boom" });
    expect(state.status).toBe("error");
  });

  it("stores the guild snapshot on guild.sync", () => {
    let state = initialSimState();
    state = reduceSim(state, {
      ...base(),
      type: "guild.sync",
      guild: {
        guildId: "g",
        botUserId: SIM_BOT_ID,
        channels: [],
        members: [{ id: SIM_USER_ID, username: "u", displayName: "User", roles: [] }],
        roles: [],
        emojis: [],
        messages: [],
      },
    });
    expect(state.guild?.members[0].id).toBe(SIM_USER_ID);
  });
});
