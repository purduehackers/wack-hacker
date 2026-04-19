import { describe, it, expect } from "vitest";

import {
  messagePacket,
  reactionPacket,
  deletePacket,
  voiceStatePacket,
  threadCreatePacket,
} from "../test/fixtures";
import { PacketCodec, PacketSchema } from "./packets";

describe("PacketCodec", () => {
  it("roundtrips a message create packet", () => {
    const decoded = PacketCodec.decode(PacketCodec.encode(messagePacket("hello")));
    expect(decoded.type).toBe("GATEWAY_MESSAGE_CREATE");
    expect(decoded.data).toMatchObject({ id: "msg-1", content: "hello" });
    expect(decoded.timestamp).toBeInstanceOf(Date);
  });

  it("roundtrips a reaction add packet", () => {
    const decoded = PacketCodec.decode(PacketCodec.encode(reactionPacket("👋")));
    expect(decoded.type).toBe("GATEWAY_MESSAGE_REACTION_ADD");
    expect(decoded.data).toMatchObject({ emoji: { name: "👋" } });
  });

  it("roundtrips a reaction remove packet", () => {
    const decoded = PacketCodec.decode(
      PacketCodec.encode(reactionPacket("👋", "GATEWAY_MESSAGE_REACTION_REMOVE")),
    );
    expect(decoded.type).toBe("GATEWAY_MESSAGE_REACTION_REMOVE");
  });

  it("roundtrips a message delete packet", () => {
    const decoded = PacketCodec.decode(PacketCodec.encode(deletePacket()));
    expect(decoded.type).toBe("GATEWAY_MESSAGE_DELETE");
  });

  it("roundtrips a voice state update packet", () => {
    const decoded = PacketCodec.decode(PacketCodec.encode(voiceStatePacket("vc-1")));
    expect(decoded.type).toBe("GATEWAY_VOICE_STATE_UPDATE");
    if (decoded.type === "GATEWAY_VOICE_STATE_UPDATE") expect(decoded.data.channelId).toBe("vc-1");
  });

  it("roundtrips a thread create packet", () => {
    const decoded = PacketCodec.decode(PacketCodec.encode(threadCreatePacket()));
    expect(decoded.type).toBe("GATEWAY_THREAD_CREATE");
  });

  it("preserves optional fields on messages", () => {
    const decoded = PacketCodec.decode(
      PacketCodec.encode(
        messagePacket("hello", {
          thread: { parentId: "ch-parent", parentName: "parent" },
          memberRoles: ["role-1", "role-2"],
          author: { id: "user-1", username: "alice", nickname: "Ali", bot: false },
          attachments: [
            {
              id: "a1",
              url: "https://x.com/f.png",
              filename: "f.png",
              contentType: "image/png",
              size: 1024,
            },
          ],
          mentions: ["bot-123", "user-2"],
          reference: {
            messageId: "msg-0",
            channelId: "ch-1",
            authorId: "bot-123",
          },
        }),
      ),
    );

    if (decoded.type !== "GATEWAY_MESSAGE_CREATE") throw new Error("wrong type");
    expect(decoded.data.thread?.parentId).toBe("ch-parent");
    expect(decoded.data.memberRoles).toEqual(["role-1", "role-2"]);
    expect(decoded.data.author.nickname).toBe("Ali");
    expect(decoded.data.attachments).toHaveLength(1);
    expect(decoded.data.mentions).toEqual(["bot-123", "user-2"]);
    expect(decoded.data.reference).toEqual({
      messageId: "msg-0",
      channelId: "ch-1",
      authorId: "bot-123",
    });
  });

  it("handles voice state with null channelId", () => {
    const decoded = PacketCodec.decode(PacketCodec.encode(voiceStatePacket(null)));
    if (decoded.type === "GATEWAY_VOICE_STATE_UPDATE") expect(decoded.data.channelId).toBeNull();
  });

  it("rejects invalid JSON", () => {
    expect(() => PacketCodec.decode("not json")).toThrow();
  });
});

describe("PacketCodec - mentions defaulting", () => {
  it("defaults mentions to an empty array on MESSAGE_CREATE when omitted on the wire", () => {
    const raw = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: new Date("2024-01-01"),
      data: {
        id: "msg-1",
        attachments: [],
        author: { id: "user-1", username: "alice" },
        channel: { id: "ch-1", name: "general" },
        guildId: "guild-1",
        content: "hi",
        timestamp: "2024-01-01T00:00:00.000+00:00",
      },
    });
    const decoded = PacketCodec.decode(raw);
    if (decoded.type !== "GATEWAY_MESSAGE_CREATE") throw new Error("wrong type");
    expect(decoded.data.mentions).toEqual([]);
  });

  it("leaves mentions undefined on MESSAGE_UPDATE when omitted (no default leak)", () => {
    const raw = JSON.stringify({
      type: "GATEWAY_MESSAGE_UPDATE",
      timestamp: new Date("2024-01-01"),
      data: { id: "msg-1", channelId: "ch-1", guildId: "guild-1" },
    });
    const decoded = PacketCodec.decode(raw);
    if (decoded.type !== "GATEWAY_MESSAGE_UPDATE") throw new Error("wrong type");
    expect(decoded.data.mentions).toBeUndefined();
  });
});

describe("PacketSchema validation", () => {
  it("rejects unknown type", () => {
    expect(
      PacketSchema.safeParse({ type: "GATEWAY_UNKNOWN", timestamp: new Date(), data: {} }).success,
    ).toBe(false);
  });

  it("rejects message missing required fields", () => {
    expect(
      PacketSchema.safeParse({
        type: "GATEWAY_MESSAGE_CREATE",
        timestamp: new Date(),
        data: { id: "msg-1" },
      }).success,
    ).toBe(false);
  });

  it("accepts a valid message packet", () => {
    expect(PacketSchema.safeParse(messagePacket("hello")).success).toBe(true);
  });

  it("rejects reaction missing channelId", () => {
    expect(
      PacketSchema.safeParse({
        type: "GATEWAY_MESSAGE_REACTION_ADD",
        timestamp: new Date(),
        data: {
          messageId: "m1",
          guildId: "g1",
          emoji: { id: null, name: "👋" },
          creator: { id: "u1", username: "a" },
        },
      }).success,
    ).toBe(false);
  });
});
