import { describe, it, expect } from "vitest";

import { DISCORD_IDS } from "@/lib/protocol/constants";
import { createMockAPI, asAPI } from "@/lib/test/fixtures";

import type { SlashCommandContext } from "./types";

import { respond, isOrganizer } from "./helpers";
import { parseSubcommand, parseOptions } from "./registry";

function fakeCtx(roles: string[] = []) {
  const discord = createMockAPI();
  return {
    ctx: {
      interaction: {
        id: "1",
        application_id: "app-1",
        type: 2,
        token: "tok-1",
        version: 1,
        member: { user: { id: "u1", username: "alice" }, roles, nick: null },
      },
      discord: asAPI(discord),
      options: new Map(),
    } as SlashCommandContext,
    discord,
  };
}

describe("respond", () => {
  it("calls interactions.editReply with correct args", async () => {
    const { ctx, discord } = fakeCtx();
    await respond(ctx, "hello");
    expect(discord.callsTo("interactions.editReply")).toEqual([
      ["app-1", "tok-1", { content: "hello" }],
    ]);
  });
});

describe("isOrganizer", () => {
  it("returns true when user has organizer role", () => {
    expect(isOrganizer(fakeCtx([DISCORD_IDS.roles.ORGANIZER]).ctx)).toBe(true);
  });

  it("returns false when user lacks organizer role", () => {
    expect(isOrganizer(fakeCtx(["other-role"]).ctx)).toBe(false);
  });

  it("returns false when member is undefined", () => {
    const { ctx } = fakeCtx();
    ctx.interaction.member = undefined;
    expect(isOrganizer(ctx)).toBe(false);
  });
});

describe("parseSubcommand", () => {
  it("returns undefined for undefined input", () => {
    expect(parseSubcommand(undefined)).toBeUndefined();
  });

  it("returns subcommand name for type 1", () => {
    expect(parseSubcommand([{ name: "view", type: 1 }])).toBe("view");
  });

  it("returns subcommand group name for type 2", () => {
    expect(parseSubcommand([{ name: "admin", type: 2 }])).toBe("admin");
  });

  it("returns undefined when no subcommand present", () => {
    expect(parseSubcommand([{ name: "flag", type: 5, value: true }])).toBeUndefined();
  });
});

describe("parseOptions", () => {
  it("returns empty map for undefined input", () => {
    expect(parseOptions(undefined).size).toBe(0);
  });

  it("returns empty map for empty array", () => {
    expect(parseOptions([]).size).toBe(0);
  });

  it("parses flat options", () => {
    const result = parseOptions([
      { name: "question", type: 3, value: "what is this?" },
      { name: "count", type: 4, value: 5 },
      { name: "verbose", type: 5, value: true },
    ]);
    expect(result.get("question")).toBe("what is this?");
    expect(result.get("count")).toBe(5);
    expect(result.get("verbose")).toBe(true);
  });

  it("flattens nested subcommand options", () => {
    const result = parseOptions([
      {
        name: "view",
        type: 1,
        options: [{ name: "user", type: 6, value: "user-123" }],
      },
    ]);
    expect(result.get("user")).toBe("user-123");
  });

  it("handles deeply nested options", () => {
    const result = parseOptions([
      {
        name: "group",
        type: 2,
        options: [
          {
            name: "sub",
            type: 1,
            options: [{ name: "deep", type: 3, value: "found" }],
          },
        ],
      },
    ]);
    expect(result.get("deep")).toBe("found");
  });
});
