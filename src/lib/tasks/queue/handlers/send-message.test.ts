import { describe, it, expect } from "vitest";

import { createMockAPI, asAPI } from "@/lib/test/fixtures";

import { sendMessage } from "./send-message.ts";

describe("sendMessage task", () => {
  it("validates payload", () => {
    expect(sendMessage.schema.safeParse({ channelId: "ch-1", content: "hi" }).success).toBe(true);
    expect(sendMessage.schema.safeParse({}).success).toBe(false);
  });

  it("sends a message", async () => {
    const discord = createMockAPI();
    await sendMessage.handle({ channelId: "ch-1", content: "hello" }, asAPI(discord));
    expect(discord.callsTo("channels.createMessage")).toEqual([["ch-1", { content: "hello" }]]);
  });
});
