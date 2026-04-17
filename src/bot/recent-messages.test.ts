import { describe, it, expect } from "vitest";

import { asAPI, createMockAPI } from "@/lib/test/fixtures";

import { fetchRecentMessages } from "./recent-messages";

function mockWithMessages(messages: unknown[]) {
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
    const mock = mockWithMessages([
      { author: { username: "a" }, content: "", timestamp: "2024-01-01T00:00:00Z" },
      { author: { username: "b" }, content: "   ", timestamp: "2024-01-01T00:01:00Z" },
    ]);
    const result = await fetchRecentMessages(asAPI(mock), "ch-1", "msg-0");
    expect(result).toBeUndefined();
  });

  it("reverses to chronological order and prefers global_name", async () => {
    const mock = mockWithMessages([
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
