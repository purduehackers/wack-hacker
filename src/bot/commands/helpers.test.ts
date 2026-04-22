import { describe, it, expect } from "vitest";

import { DISCORD_IDS } from "@/lib/protocol/constants";
import { fakeSlashCommandCtx } from "@/lib/test/fixtures";

import { isAdmin, isOrganizer } from "./helpers";

describe("isOrganizer", () => {
  it("returns true when the organizer role is present", () => {
    const { ctx } = fakeSlashCommandCtx({ roles: [DISCORD_IDS.roles.ORGANIZER] });
    expect(isOrganizer(ctx)).toBe(true);
  });

  it("returns false when the role is absent", () => {
    const { ctx } = fakeSlashCommandCtx({ roles: ["other-role"] });
    expect(isOrganizer(ctx)).toBe(false);
  });

  it("returns false when member is missing", () => {
    const { ctx } = fakeSlashCommandCtx({ noMember: true });
    expect(isOrganizer(ctx)).toBe(false);
  });
});

describe("isAdmin", () => {
  it("returns true when the admin role is present", () => {
    const { ctx } = fakeSlashCommandCtx({ roles: [DISCORD_IDS.roles.ADMIN] });
    expect(isAdmin(ctx)).toBe(true);
  });

  it("returns false when the role is absent", () => {
    const { ctx } = fakeSlashCommandCtx({ roles: [DISCORD_IDS.roles.ORGANIZER] });
    expect(isAdmin(ctx)).toBe(false);
  });

  it("returns false when member is missing", () => {
    const { ctx } = fakeSlashCommandCtx({ noMember: true });
    expect(isAdmin(ctx)).toBe(false);
  });
});
