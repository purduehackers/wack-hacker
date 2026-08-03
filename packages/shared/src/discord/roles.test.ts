import { expect, test } from "vitest";

import { DISCORD_IDS } from "./constants.ts";
import { UserRole, isUserRole, roleAtLeast, roleFromMemberRoles } from "./roles.ts";

const { ADMIN, ORGANIZER, WACKY } = DISCORD_IDS.roles;

test("resolution is total: every absence lands on public", () => {
  // A role lookup must never fail — an outage becoming a privilege question is
  // exactly the wrong failure mode.
  expect(roleFromMemberRoles(undefined)).toBe(UserRole.Public);
  expect(roleFromMemberRoles([])).toBe(UserRole.Public);
  expect(roleFromMemberRoles([WACKY])).toBe(UserRole.Public);
});

test("recognises organizer and admin", () => {
  expect(roleFromMemberRoles([ORGANIZER])).toBe(UserRole.Organizer);
  expect(roleFromMemberRoles([ADMIN])).toBe(UserRole.Admin);
});

test("holding both roles resolves to the higher tier", () => {
  expect(roleFromMemberRoles([ORGANIZER, ADMIN])).toBe(UserRole.Admin);
  expect(roleFromMemberRoles([ADMIN, ORGANIZER])).toBe(UserRole.Admin);
});

test("unrelated roles do not grant anything", () => {
  expect(roleFromMemberRoles([WACKY, "000000000000000000"])).toBe(UserRole.Public);
});

test("roleAtLeast is reflexive and ordered", () => {
  for (const role of [UserRole.Public, UserRole.Organizer, UserRole.Admin]) {
    expect(roleAtLeast(role, role)).toBe(true);
  }

  expect(roleAtLeast(UserRole.Admin, UserRole.Organizer)).toBe(true);
  expect(roleAtLeast(UserRole.Admin, UserRole.Public)).toBe(true);
  expect(roleAtLeast(UserRole.Organizer, UserRole.Public)).toBe(true);

  expect(roleAtLeast(UserRole.Public, UserRole.Organizer)).toBe(false);
  expect(roleAtLeast(UserRole.Public, UserRole.Admin)).toBe(false);
  expect(roleAtLeast(UserRole.Organizer, UserRole.Admin)).toBe(false);
});

test("isUserRole rejects anything not a tier", () => {
  expect(isUserRole("organizer")).toBe(true);
  expect(isUserRole("Organizer")).toBe(false);
  expect(isUserRole("owner")).toBe(false);
  expect(isUserRole(undefined)).toBe(false);
  expect(isUserRole(1)).toBe(false);
});
