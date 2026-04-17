import { describe, it, expect } from "vitest";

import { asAPI, createMockAPI, messagePacket } from "@/lib/test/fixtures";

import { buildTurnContext, fetchRecentMessages } from "./chat-context";

function mockDiscordWithMessages(messages: unknown[]) {
  const mock = createMockAPI();
  mock.channels.getMessages = async () => messages as never;
  return mock;
}

describe("fetchRecentMessages", () => {
  it("returns undefined when fetch fails", async () => {
    const mock = createMockAPI();
    mock.channels.getMessages = async () => {
      throw new Error("rate limited");
    };
    const result = await fetchRecentMessages(asAPI(mock), "ch-1", "msg-0");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no messages have content", async () => {
    const mock = mockDiscordWithMessages([
      { author: { username: "a" }, content: "", timestamp: "2024-01-01T00:00:00Z" },
      { author: { username: "b" }, content: "   ", timestamp: "2024-01-01T00:01:00Z" },
    ]);
    const result = await fetchRecentMessages(asAPI(mock), "ch-1", "msg-0");
    expect(result).toBeUndefined();
  });

  it("maps messages in chronological order, preferring global_name", async () => {
    const mock = mockDiscordWithMessages([
      {
        author: { username: "b", global_name: "Bob" },
        content: "world",
        timestamp: "2024-01-01T13:02:00Z",
      },
      { author: { username: "a" }, content: "hello", timestamp: "2024-01-01T13:01:00Z" },
    ]);
    const result = await fetchRecentMessages(asAPI(mock), "ch-1", "msg-0");
    expect(result).toEqual([
      { author: "a", content: "hello", timestamp: expect.any(String) },
      { author: "Bob", content: "world", timestamp: expect.any(String) },
    ]);
  });
});

describe("buildTurnContext", () => {
  it("uses packet thread info when in a thread", async () => {
    const mock = createMockAPI();
    const packet = messagePacket("hi", { thread: { parentId: "p1", parentName: "parent" } });
    const result = await buildTurnContext(asAPI(mock), packet);
    expect(result.thread).toEqual({
      id: "ch-1",
      name: "general",
      parentChannel: { id: "p1", name: "parent" },
    });
    expect(result.channel).toEqual({ id: "ch-1", name: "general" });
  });

  it("synthesizes thread info from override when a thread was just created", async () => {
    const mock = createMockAPI();
    const packet = messagePacket("hi");
    const result = await buildTurnContext(asAPI(mock), packet, {
      id: "thread-99",
      name: "my-thread",
    });
    expect(result.thread).toEqual({
      id: "thread-99",
      name: "my-thread",
      parentChannel: { id: "ch-1", name: "general" },
    });
    expect(result.channel).toEqual({ id: "thread-99", name: "my-thread" });
  });

  it("leaves thread undefined when no override and packet is not a thread message", async () => {
    const mock = createMockAPI();
    const packet = messagePacket("hi");
    const result = await buildTurnContext(asAPI(mock), packet);
    expect(result.thread).toBeUndefined();
  });

  it("fetches recent messages from data.channel.id", async () => {
    const mock = createMockAPI();
    const packet = messagePacket("hi");
    await buildTurnContext(asAPI(mock), packet, { id: "thread-99", name: "t" });
    const calls = mock.callsTo("channels.getMessages");
    expect(calls[0][0]).toBe("ch-1");
  });
});
