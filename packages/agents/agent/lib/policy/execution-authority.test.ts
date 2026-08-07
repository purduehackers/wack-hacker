import { describe, expect, test } from "bun:test";

import { DISCORD_IDS } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";

import type { SecondPartyApprovalRecord } from "./approval-record.ts";
import { resolveExecutionAuthority, type ExecutionAuthorityInput } from "./execution-authority.ts";

const requesterId = "10000000000000000";
const approverId = "10000000000000001";
const record: SecondPartyApprovalRecord = {
  requesterUserId: requesterId,
  mode: "second-party",
  minApproverRole: "organizer",
  tool: "delete_project",
  risk: "destructive",
};

function authorityInput(
  stored: SecondPartyApprovalRecord | undefined = record,
): ExecutionAuthorityInput {
  return {
    current: { userId: approverId, role: "organizer", source: "chat" },
    approvalRequesterId: requesterId,
    approvalRequesterMemberRoles: [DISCORD_IDS.roles.ORGANIZER],
    sessionId: "session-1",
    callId: "call-1",
    tool: "delete_project",
    risk: "destructive",
    requesterMinRole: "organizer",
    approvalPolicies: { read: async () => Result.ok(stored) },
  };
}

describe("second-party execution authority", () => {
  test("executes and audits as the requester with the distinct approver as decidedBy", async () => {
    expect(await resolveExecutionAuthority(authorityInput())).toEqual({
      principal: { userId: requesterId, role: "organizer", source: "chat" },
      decidedBy: approverId,
    });
  });

  test("binds requester, tool, risk, and minimum role to the persisted policy", async () => {
    const conflictingPolicies: SecondPartyApprovalRecord[] = [
      { ...record, requesterUserId: "10000000000000002" },
      { ...record, tool: "delete_other_project" },
      { ...record, risk: "write" },
    ];

    for (const persistedPolicy of conflictingPolicies) {
      expect(await resolveExecutionAuthority(authorityInput(persistedPolicy))).toBeUndefined();
    }
    expect(
      await resolveExecutionAuthority({
        ...authorityInput(record),
        current: { userId: approverId, role: "admin", source: "chat" },
        approvalRequesterMemberRoles: [DISCORD_IDS.roles.ADMIN],
        requesterMinRole: "admin",
      }),
    ).toBeUndefined();
  });

  test("requires a distinct current approver with enough current access", async () => {
    expect(
      await resolveExecutionAuthority({
        ...authorityInput(),
        current: { userId: requesterId, role: "organizer", source: "chat" },
      }),
    ).toBeUndefined();
    expect(
      await resolveExecutionAuthority({
        ...authorityInput(),
        current: { userId: approverId, role: "public", source: "chat" },
      }),
    ).toBeUndefined();
  });

  test("denies execution when the requester has lost their required fresh Discord role", async () => {
    expect(
      await resolveExecutionAuthority({
        ...authorityInput(),
        approvalRequesterMemberRoles: [],
      }),
    ).toBeUndefined();
  });

  test("denies a replay whose session/call receipt no longer resolves", async () => {
    expect(
      await resolveExecutionAuthority({
        ...authorityInput(),
        callId: "call-replayed",
        approvalPolicies: {
          read: async (_sessionId: string, callId: string) =>
            Result.ok(callId === "call-1" ? record : undefined),
        },
      }),
    ).toBeUndefined();
  });
});
