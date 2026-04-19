import { describe, it, expect } from "vitest";

import { DISCORD_IDS } from "@/lib/protocol/constants";

import type { SlashCommandContext } from "./types";

import { isAdmin, isOrganizer } from "./helpers";

function ctx(roles: string[]): SlashCommandContext {
  return {
    interaction: {
      id: "i",
      application_id: "a",
      type: 2,
      token: "t",
      version: 1,
      member: {
        user: { id: "u", username: "u" },
        roles,
      },
    },
    discord: {} as SlashCommandContext["discord"],
    options: new Map(),
  };
}

describe("isOrganizer", () => {
  it("returns true when the organizer role is present", () => {
    expect(isOrganizer(ctx([DISCORD_IDS.roles.ORGANIZER]))).toBe(true);
  });

  it("returns false when the role is absent", () => {
    expect(isOrganizer(ctx(["other-role"]))).toBe(false);
  });

  it("returns false when member is missing", () => {
    const c: SlashCommandContext = {
      interaction: { id: "i", application_id: "a", type: 2, token: "t", version: 1 },
      discord: {} as SlashCommandContext["discord"],
      options: new Map(),
    };
    expect(isOrganizer(c)).toBe(false);
  });
});

describe("isAdmin", () => {
  it("returns true when the admin role is present", () => {
    expect(isAdmin(ctx([DISCORD_IDS.roles.ADMIN]))).toBe(true);
  });

  it("returns false when the role is absent", () => {
    expect(isAdmin(ctx([DISCORD_IDS.roles.ORGANIZER]))).toBe(false);
  });

  it("returns false when member is missing", () => {
    const c: SlashCommandContext = {
      interaction: { id: "i", application_id: "a", type: 2, token: "t", version: 1 },
      discord: {} as SlashCommandContext["discord"],
      options: new Map(),
    };
    expect(isAdmin(c)).toBe(false);
  });
});
