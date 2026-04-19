import { describe, it, expect } from "vitest";

import { asAPI, createMockAPI } from "@/lib/test/fixtures";

import { fetchRecentMessages, fetchReferencedMessageContext } from "./recent-messages";

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
      { id: "m1", author: { username: "a" }, content: "", timestamp: "2024-01-01T00:00:00Z" },
      { id: "m2", author: { username: "b" }, content: "   ", timestamp: "2024-01-01T00:01:00Z" },
    ]);
    const result = await fetchRecentMessages(asAPI(mock), "ch-1", "msg-0");
    expect(result).toBeUndefined();
  });

  it("reverses to chronological order and prefers global_name", async () => {
    const mock = mockWithMessages([
      {
        id: "m2",
        author: { username: "b", global_name: "Bob" },
        content: "world",
        timestamp: "2024-01-01T13:02:00Z",
      },
      {
        id: "m1",
        author: { username: "a" },
        content: "hello",
        timestamp: "2024-01-01T13:01:00Z",
      },
    ]);
    const result = await fetchRecentMessages(asAPI(mock), "ch-1", "msg-0");
    expect(result).toEqual([
      { id: "m1", author: "a", content: "hello", timestamp: expect.any(String) },
      { id: "m2", author: "Bob", content: "world", timestamp: expect.any(String) },
    ]);
  });
});

function rawMsg(id: string, username: string, content: string, time: string): unknown {
  return { id, author: { username }, content, timestamp: time };
}

function mockWithAnchor(anchor: unknown, priors: unknown[]) {
  const mock = createMockAPI();
  mock.channels.getMessage = async () => anchor as never;
  mock.channels.getMessages = async () => priors as never;
  return mock;
}

describe("fetchReferencedMessageContext", () => {
  it("returns undefined when anchor fetch fails", async () => {
    const mock = createMockAPI();
    mock.channels.getMessage = async () => {
      throw new Error("not found");
    };
    const result = await fetchReferencedMessageContext(asAPI(mock), "ch-1", "anchor");
    expect(result).toBeUndefined();
  });

  it("returns undefined when priors fetch fails", async () => {
    const mock = createMockAPI();
    mock.channels.getMessage = async () =>
      rawMsg("anchor", "a", "hi", "2024-01-01T13:05:00Z") as never;
    mock.channels.getMessages = async () => {
      throw new Error("rate limited");
    };
    const result = await fetchReferencedMessageContext(asAPI(mock), "ch-1", "anchor");
    expect(result).toBeUndefined();
  });

  it("puts the anchor last and reverses priors into chronological order", async () => {
    const mock = mockWithAnchor(rawMsg("anchor", "c", "anchor msg", "2024-01-01T13:05:00Z"), [
      rawMsg("p-newer", "b", "second", "2024-01-01T13:02:00Z"),
      rawMsg("p-older", "a", "first", "2024-01-01T13:01:00Z"),
    ]);
    const result = await fetchReferencedMessageContext(asAPI(mock), "ch-1", "anchor");
    expect(result).toEqual([
      { id: "p-older", author: "a", content: "first", timestamp: expect.any(String) },
      { id: "p-newer", author: "b", content: "second", timestamp: expect.any(String) },
      { id: "anchor", author: "c", content: "anchor msg", timestamp: expect.any(String) },
    ]);
  });

  it("filters empty-content priors but keeps the anchor when it has content", async () => {
    const mock = mockWithAnchor(rawMsg("anchor", "c", "anchor msg", "2024-01-01T13:05:00Z"), [
      rawMsg("p-empty", "b", "   ", "2024-01-01T13:02:00Z"),
    ]);
    const result = await fetchReferencedMessageContext(asAPI(mock), "ch-1", "anchor");
    expect(result).toEqual([
      { id: "anchor", author: "c", content: "anchor msg", timestamp: expect.any(String) },
    ]);
  });

  it("keeps an attachment-only anchor with a placeholder so it stays last", async () => {
    const mock = mockWithAnchor(rawMsg("anchor", "c", "", "2024-01-01T13:05:00Z"), [
      rawMsg("p-older", "a", "first", "2024-01-01T13:01:00Z"),
    ]);
    const result = await fetchReferencedMessageContext(asAPI(mock), "ch-1", "anchor");
    expect(result).toEqual([
      { id: "p-older", author: "a", content: "first", timestamp: expect.any(String) },
      { id: "anchor", author: "c", content: "(no text content)", timestamp: expect.any(String) },
    ]);
  });
});
