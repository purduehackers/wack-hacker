import { describe, it, expect } from "vitest";

import { DISCORD_IDS } from "../protocol/constants.ts";
import { messagePacket } from "../test/fixtures/index.ts";
import { AgentContext, roleFromMemberRoles } from "./context.ts";

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

  it("synthesizes thread info from threadOverride", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"), {
      threadOverride: { id: "thread-99", name: "my-thread" },
    });
    expect(ctx.channel).toEqual({ id: "thread-99", name: "my-thread" });
    expect(ctx.thread).toEqual({
      id: "thread-99",
      name: "my-thread",
      parentChannel: { id: "ch-1", name: "general" },
    });
  });

  it("threadOverride takes priority over packet thread info", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { thread: { parentId: "p1", parentName: "parent" } }),
      { threadOverride: { id: "thread-99", name: "new" } },
    );
    expect(ctx.thread?.id).toBe("thread-99");
    expect(ctx.channel.id).toBe("thread-99");
  });

  it("attaches recentMessages when provided", () => {
    const messages = [{ id: "m-bob", author: "bob", content: "hi", timestamp: "1:00 PM" }];
    const ctx = AgentContext.fromPacket(messagePacket("hello"), { recentMessages: messages });
    expect(ctx.recentMessages).toEqual(messages);
  });

  it("attaches referencedContext when provided", () => {
    const ref = [{ id: "anchor", author: "carol", content: "original", timestamp: "12:55 PM" }];
    const ctx = AgentContext.fromPacket(messagePacket("hello"), { referencedContext: ref });
    expect(ctx.referencedContext).toEqual(ref);
  });
});

describe("AgentContext.fromPacket: scheduling fields", () => {
  it("captures the current instant as minute-precision ISO 8601", () => {
    // Minute precision, not milliseconds — nowISO lands in the system prompt,
    // and sub-minute churn would bust the prompt cache every turn.
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    expect(ctx.nowISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    expect(Math.abs(Date.now() - new Date(ctx.nowISO).getTime())).toBeLessThan(61_000);
  });

  it("defaults timezone to America/New_York", () => {
    expect(AgentContext.fromPacket(messagePacket("hello")).timezone).toBe("America/New_York");
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
    expect(restored.nowISO).toBe(original.nowISO);
    expect(restored.timezone).toBe(original.timezone);
  });

  it("defaults nowISO + timezone when deserializing a legacy payload", () => {
    // Legacy serialized contexts pre-date nowISO/timezone — fromJSON must
    // still accept them and compute fresh defaults so the orchestrator gets
    // a usable `{{NOW_ISO}}` for the turn.
    const ctx = AgentContext.fromJSON({
      userId: "u",
      username: "u",
      nickname: "u",
      channel: { id: "c", name: "c" },
      date: "Monday, April 13, 2026",
    });
    expect(ctx.timezone).toBe("America/New_York");
    expect(ctx.nowISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    expect(Math.abs(Date.now() - new Date(ctx.nowISO).getTime())).toBeLessThan(61_000);
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

  it("replaces {{NOW_ISO}} and {{USER_TZ}} placeholders", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = ctx.buildInstructions("Now: {{NOW_ISO}}\nTZ: {{USER_TZ}}");
    expect(result).not.toContain("{{NOW_ISO}}");
    expect(result).not.toContain("{{USER_TZ}}");
    expect(result).toContain(ctx.nowISO);
    expect(result).toContain(ctx.timezone);
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

  it("uses recent_thread_messages tag when lead-in came from the thread", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { thread: { parentId: "p1", parentName: "parent" } }),
      { recentMessages: [{ id: "m-bob", author: "bob", content: "hey", timestamp: "1:00 PM" }] },
    );
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("<recent_thread_messages>");
    expect(result).not.toContain("<recent_channel_messages>");
  });

  it("uses recent_channel_messages tag when not in a thread", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"), {
      recentMessages: [{ id: "m-bob", author: "bob", content: "hey", timestamp: "1:00 PM" }],
    });
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("<recent_channel_messages>");
    expect(result).not.toContain("<recent_thread_messages>");
  });

  it("uses recent_channel_messages tag when a new thread was just created", () => {
    // threadOverride is set (so context has thread info) but recentMessages
    // came from the parent channel, not the newly-created thread.
    const ctx = AgentContext.fromPacket(messagePacket("hello"), {
      threadOverride: { id: "thread-99", name: "new" },
      recentMessages: [{ id: "m-bob", author: "bob", content: "hey", timestamp: "1:00 PM" }],
    });
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("<recent_channel_messages>");
    expect(result).not.toContain("<recent_thread_messages>");
  });

  it("renders <referenced_message_context> when referencedContext is set", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"), {
      recentMessages: [{ id: "m-bob", author: "bob", content: "hey", timestamp: "1:00 PM" }],
      referencedContext: [
        { id: "anchor", author: "carol", content: "original", timestamp: "12:55 PM" },
      ],
    });
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("<referenced_message_context>");
    expect(result).toContain("carol: original");
  });

  it("omits <referenced_message_context> when referencedContext is empty", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"), {
      recentMessages: [{ id: "m-bob", author: "bob", content: "hey", timestamp: "1:00 PM" }],
    });
    expect(ctx.buildInstructions("Base.")).not.toContain("<referenced_message_context>");
  });

  it("falls back to thread presence when recentMessagesFromThread is absent", () => {
    // Legacy serialized context — no recentMessagesFromThread field.
    const ctx = AgentContext.fromJSON({
      userId: "u",
      username: "u",
      nickname: "u",
      channel: { id: "t", name: "t" },
      thread: { id: "t", name: "t", parentChannel: { id: "p", name: "p" } },
      date: "today",
      recentMessages: [{ id: "m-bob", author: "bob", content: "hey", timestamp: "1:00 PM" }],
    });
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("<recent_thread_messages>");
  });
});

describe("AgentContext.contextBlock", () => {
  it("escapes quotes in username and channel name", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", {
        author: { id: "u1", username: 'al"ice' },
        channel: { id: "ch-1", name: 'gen"eral' },
      }),
    );
    const result = ctx.contextBlock();
    expect(result).toContain(`username: ${JSON.stringify('al"ice')}`);
    expect(result).toContain(`name: ${JSON.stringify('#gen"eral')}`);
  });
});

describe("AgentContext.contextBlock: lead-in caps", () => {
  it("caps the recent-messages block at 4,000 chars, dropping oldest lines first", () => {
    // 30 messages × ~280 chars ≈ 8.4k chars — well over the block cap.
    const recentMessages = Array.from({ length: 30 }, (_, i) => ({
      id: `m-${i}`,
      author: `user${i}`,
      content: `msg${i} ${"x".repeat(270)}`,
      timestamp: "1:00 PM",
    }));
    const ctx = AgentContext.fromPacket(messagePacket("hello"), { recentMessages });
    const result = ctx.buildInstructions("Base.");

    const block = result.match(/<recent_channel_messages>\n([\s\S]*)\n<\/recent_channel_messages>/);
    expect(block).not.toBeNull();
    expect(block![1]!.length).toBeLessThanOrEqual(4_000);
    // Newest messages survive; oldest are dropped.
    expect(block![1]).toContain("msg29 ");
    expect(block![1]).not.toContain("msg0 ");
  });

  it("caps the referenced block at 4,000 chars while keeping the anchor last", () => {
    const referencedContext = Array.from({ length: 30 }, (_, i) => ({
      id: `r-${i}`,
      author: `user${i}`,
      content: `ref${i} ${"x".repeat(270)}`,
      timestamp: "12:55 PM",
    }));
    const ctx = AgentContext.fromPacket(messagePacket("hello"), { referencedContext });
    const result = ctx.buildInstructions("Base.");

    const block = result.match(
      /<referenced_message_context>\n[\s\S]*?chronological order\.\n([\s\S]*)\n<\/referenced_message_context>/,
    );
    expect(block).not.toBeNull();
    expect(block![1]!.length).toBeLessThanOrEqual(4_000);
    // The reply anchor is the last entry and must survive the cap.
    expect(block![1]!.trimEnd().endsWith(`ref29 ${"x".repeat(270)}`)).toBe(true);
    expect(block![1]).not.toContain("ref0 ");
  });

  it("leaves a small lead-in block untouched", () => {
    const recentMessages = [
      { id: "m-bob", author: "bob", content: "hey", timestamp: "1:00 PM" },
      { id: "m-eve", author: "eve", content: "yo", timestamp: "1:01 PM" },
    ];
    const ctx = AgentContext.fromPacket(messagePacket("hello"), { recentMessages });
    const result = ctx.buildInstructions("Base.");
    expect(result).toContain("[1:00 PM] bob: hey");
    expect(result).toContain("[1:01 PM] eve: yo");
  });
});

describe("AgentContext.subagentContextBlock", () => {
  it("carries the requesting user, channel, date, instant, and timezone", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { author: { id: "u1", username: "alice", nickname: "Ali" } }),
    );
    const block = ctx.subagentContextBlock();
    expect(block).toContain("<execution_context>");
    expect(block).toContain('requesting_user: "Ali" (discord id u1)');
    expect(block).toContain('channel: "#general"');
    expect(block).toContain(`date: ${ctx.date}`);
    expect(block).toContain(`now: ${ctx.nowISO}`);
    expect(block).toContain(`tz: ${ctx.timezone}`);
  });

  it("escapes quotes in the nickname", () => {
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", { author: { id: "u1", username: "alice", nickname: 'A"li' } }),
    );
    expect(ctx.subagentContextBlock()).toContain(`requesting_user: ${JSON.stringify('A"li')}`);
  });
});

describe("AgentContext.source", () => {
  const base = {
    userId: "u",
    username: "u",
    nickname: "u",
    channel: { id: "c", name: "c" },
    date: "today",
  };

  it("defaults to 'chat' when the serialized field is absent (legacy contexts)", () => {
    expect(AgentContext.fromJSON(base).source).toBe("chat");
  });

  it("round-trips 'scheduled' through toJSON/fromJSON", () => {
    const ctx = AgentContext.fromJSON({ ...base, source: "scheduled" });
    expect(ctx.source).toBe("scheduled");
    expect(AgentContext.fromJSON(ctx.toJSON()).source).toBe("scheduled");
  });

  it("is 'chat' for packet-built contexts", () => {
    expect(AgentContext.fromPacket(messagePacket("hello")).source).toBe("chat");
  });
});

describe("roleFromMemberRoles", () => {
  it("maps the admin role id to admin", () => {
    expect(roleFromMemberRoles([DISCORD_IDS.roles.ADMIN])).toBe("admin");
  });

  it("prefers admin when both admin and organizer ids are present", () => {
    expect(roleFromMemberRoles([DISCORD_IDS.roles.ORGANIZER, DISCORD_IDS.roles.ADMIN])).toBe(
      "admin",
    );
  });

  it("maps the organizer role id to organizer", () => {
    expect(roleFromMemberRoles([DISCORD_IDS.roles.ORGANIZER])).toBe("organizer");
  });

  it("maps unknown roles, empty lists, and undefined to public", () => {
    expect(roleFromMemberRoles(["999"])).toBe("public");
    expect(roleFromMemberRoles([])).toBe("public");
    expect(roleFromMemberRoles(undefined)).toBe("public");
  });
});
