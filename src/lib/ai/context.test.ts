import { describe, it, expect } from "vitest";

import { messagePacket } from "../test/fixtures/index.ts";
import { AgentContext } from "./context.ts";

describe("AgentContext.fromPacket", () => {
  it("extracts user identity", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { author: { id: "u1", username: "alice", nickname: "Ali" } }),
    );
    expect(ctx.userId).toBe("u1");
    expect(ctx.username).toBe("alice");
    expect(ctx.nickname).toBe("Ali");
  });

  it("falls back to username when nickname is missing", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { author: { id: "u1", username: "alice" } }),
    );
    expect(ctx.nickname).toBe("alice");
  });

  it("extracts channel info", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    expect(ctx.channel).toEqual({ id: "ch-1", name: "general" });
  });

  it("sets thread info when present", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { thread: { parentId: "p1", parentName: "parent" } }),
    );
    expect(ctx.thread).toEqual({
      id: "ch-1",
      name: "general",
      parentChannel: { id: "p1", name: "parent" },
    });
  });

  it("thread is undefined when not in a thread", () => {
    expect(AgentContext.fromPacket(messagePacket("hello")).thread).toBeUndefined();
  });

  it("maps attachments when present", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", {
        attachments: [
          {
            id: "a1",
            url: "https://x.com/f.png",
            filename: "f.png",
            contentType: "image/png",
            size: 100,
          },
        ],
      }),
    );
    expect(ctx.attachments).toEqual([
      { url: "https://x.com/f.png", filename: "f.png", contentType: "image/png" },
    ]);
  });

  it("attachments is undefined when empty", () => {
    expect(AgentContext.fromPacket(messagePacket("hello")).attachments).toBeUndefined();
  });

  it("sets a formatted date string", () => {
    expect(AgentContext.fromPacket(messagePacket("hello")).date).toMatch(/\w+, \w+ \d+, \d{4}/);
  });
});

describe("AgentContext serialization", () => {
  it("roundtrips through toJSON/fromJSON", () => {
    const original = AgentContext.fromPacket(
      messagePacket("hello", {
        thread: { parentId: "p1", parentName: "parent" },
        attachments: [
          {
            id: "a1",
            url: "https://x.com/f.png",
            filename: "f.png",
            contentType: "image/png",
            size: 100,
          },
        ],
      }),
    );
    const restored = AgentContext.fromJSON(original.toJSON());
    expect(restored.userId).toBe(original.userId);
    expect(restored.channel).toEqual(original.channel);
    expect(restored.thread).toEqual(original.thread);
    expect(restored.attachments).toEqual(original.attachments);
  });
});

describe("AgentContext.role", () => {
  it("returns 'public' when no memberRoles", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    expect(ctx.role).toBe("public");
  });

  it("returns 'admin' for admin role ID", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["1344066433172373656"] }),
    );
    expect(ctx.role).toBe("admin");
  });

  it("returns 'organizer' for organizer role ID", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["1012751663322382438"] }),
    );
    expect(ctx.role).toBe("organizer");
  });

  it("returns 'public' for unrecognized roles", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["999999999999999999"] }),
    );
    expect(ctx.role).toBe("public");
  });

  it("admin takes priority over organizer", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", {
        memberRoles: ["1012751663322382438", "1344066433172373656"],
      }),
    );
    expect(ctx.role).toBe("admin");
  });

  it("roundtrips memberRoles through serialization", () => {
    const original = AgentContext.fromPacket(
      messagePacket("hello", { memberRoles: ["1012751663322382438"] }),
    );
    const restored = AgentContext.fromJSON(original.toJSON());
    expect(restored.role).toBe("organizer");
    expect(restored.memberRoles).toEqual(["1012751663322382438"]);
  });
});

describe("AgentContext.buildInstructions", () => {
  it("replaces {{DATE}} placeholder", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = ctx.buildInstructions("Today is {{DATE}}.");
    expect(result).not.toContain("{{DATE}}");
    expect(result).toContain(ctx.date);
  });

  it("appends execution context block", () => {
    const result = AgentContext.fromPacket(messagePacket("hello")).buildInstructions("Base.");
    expect(result).toContain("<execution_context>");
    expect(result).toContain('username: "alice"');
  });

  it("includes thread info when present", () => {
    const result = AgentContext.fromPacket(
      messagePacket("hello", {
        thread: { parentId: "p1", parentName: "parent" },
      }),
    ).buildInstructions("Base.");
    expect(result).toContain("thread:");
    expect(result).toContain("parent_channel");
  });

  it("uses recent_thread_messages tag when in a thread", () => {
    const ctx = AgentContext.fromJSON({
      ...AgentContext.fromPacket(
        messagePacket("hello", { thread: { parentId: "p1", parentName: "parent" } }),
      ).toJSON(),
      recentMessages: [{ author: "bob", content: "hey", timestamp: "1:00 PM" }],
    });
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("<recent_thread_messages>");
    expect(result).not.toContain("<recent_channel_messages>");
  });

  it("uses recent_channel_messages tag when not in a thread", () => {
    const ctx = AgentContext.fromJSON({
      ...AgentContext.fromPacket(messagePacket("hello")).toJSON(),
      recentMessages: [{ author: "bob", content: "hey", timestamp: "1:00 PM" }],
    });
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("<recent_channel_messages>");
    expect(result).not.toContain("<recent_thread_messages>");
  });
});
