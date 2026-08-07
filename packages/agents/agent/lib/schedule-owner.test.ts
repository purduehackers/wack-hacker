import { describe, expect, test } from "bun:test";

import { DISCORD_IDS, UserRole } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { SessionAuthContext, SessionContext } from "eve/context";
import type { ApprovalContext } from "eve/tools/approval";

import { requirePrincipal } from "./policy/principal.ts";
import { approveScheduleMutation, requireScheduleOwner } from "./schedule-owner.ts";

type Attributes = Readonly<Record<string, string | readonly string[]>>;

function session(
  attributes: Attributes,
  options: { readonly authenticator?: string; readonly principalId?: string } = {},
): SessionContext {
  const current: SessionAuthContext = {
    authenticator: options.authenticator ?? "discord",
    principalType: "user",
    principalId: options.principalId ?? "10000000000000000",
    attributes,
  };
  return {
    session: {
      id: "session-1",
      // oxlint-disable-next-line unicorn/no-null -- Eve models a missing initiator as null
      auth: { current, initiator: null },
      turn: { id: "turn-1", sequence: 1 },
    },
    getSandbox: async () => {
      throw new Error("unexpected sandbox access");
    },
    getSkill: () => {
      throw new Error("unexpected skill access");
    },
  };
}

function approvalContext(context: SessionContext): ApprovalContext {
  return {
    ...context,
    approvedTools: new Set(),
    callId: "call-1",
    toolName: "schedule_task",
  };
}

describe("scheduled task ownership", () => {
  test("derives owner and the rendered destination only from trusted Discord auth", () => {
    const context = session({
      channelId: "20000000000000000",
      threadId: "30000000000000000",
      renderChannelId: "40000000000000000",
      memberRoles: [DISCORD_IDS.roles.ORGANIZER],
    });
    expect(requireScheduleOwner(context)).toEqual({
      ownerId: "10000000000000000",
      channelId: "40000000000000000",
      memberRoles: [DISCORD_IDS.roles.ORGANIZER],
    });
  });

  test("rejects missing, malformed, or oversized role snapshots", () => {
    const destination = { channelId: "20000000000000000" };
    expect(() => requireScheduleOwner(session(destination))).toThrow(
      "current Discord role identifiers",
    );
    expect(() =>
      requireScheduleOwner(session({ ...destination, memberRoles: ["organizer"] })),
    ).toThrow("current Discord role identifiers");
    expect(() =>
      requireScheduleOwner(
        session({
          ...destination,
          memberRoles: Array.from({ length: 65 }, () => "30000000000000000"),
        }),
      ),
    ).toThrow("current Discord role identifiers");
  });

  test("rejects non-Discord principals", () => {
    const malformed = session(
      { channelId: "20000000000000000", memberRoles: [] },
      { authenticator: "api-key" },
    );
    expect(() => requireScheduleOwner(malformed)).toThrow("authenticated Discord user");
  });
});

describe("schedule mutation RBAC", () => {
  test("denies public users and requires self approval for organizers", () => {
    const base: Attributes = {
      channelId: "20000000000000000",
      memberRoles: [],
    };
    expect(approveScheduleMutation("schedule_task", approvalContext(session(base)))).toMatchObject({
      type: "denied",
    });

    const organizer = session({
      ...base,
      memberRoles: [DISCORD_IDS.roles.ORGANIZER],
    });
    expect(approveScheduleMutation("schedule_task", approvalContext(organizer))).toBe(
      "user-approval",
    );
    expect(approveScheduleMutation("cancel_task", approvalContext(organizer))).toBe(
      "user-approval",
    );
  });

  test("raw current roles override a stale asserted admin role", () => {
    const principal = requirePrincipal(
      session({ memberRoles: [], role: UserRole.Admin }).session.auth.current,
    );
    if (Result.isError(principal)) throw principal.error;
    expect(principal.value.role).toBe(UserRole.Public);
  });

  test("validated asserted role is only a non-Discord adapter fallback", () => {
    const principal = requirePrincipal(session({ role: UserRole.Organizer }).session.auth.current);
    if (Result.isError(principal)) throw principal.error;
    expect(principal.value.role).toBe(UserRole.Organizer);
  });
});
