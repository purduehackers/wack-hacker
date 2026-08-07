import { expect, test } from "bun:test";

import { Result } from "@repo/shared/result";
import type { HookContext, HookEvent } from "eve/hooks";

import type { ActionAuditRecord } from "./audit.ts";
import { defineDomainAuditHook } from "./domain-audit-hook.ts";

function context(): HookContext {
  const current = {
    attributes: { role: "organizer" },
    authenticator: "domain-audit-test",
    principalId: "10000000000000000",
    principalType: "user",
  };
  return {
    agent: { name: "test" },
    channel: {},
    getSandbox: async () => {
      throw new Error("no sandbox in audit test");
    },
    getSkill: () => {
      throw new Error("no skills in audit test");
    },
    session: {
      id: "session-1",
      auth: { current, initiator: current },
      turn: { id: "turn-1", sequence: 0 },
    },
  };
}

test("parameterized domain audit hook preserves Requested ownership, ids, and redaction", async () => {
  const auditRecords: ActionAuditRecord[] = [];
  const hook = defineDomainAuditHook(
    {
      descriptorForTool: (name: "known") => ({
        kind: "tool",
        minRole: "organizer",
        name,
        risk: "write",
      }),
      domain: "test",
      isToolName: (value): value is "known" => value === "known",
      label: "Test",
      redactInput: true,
    },
    async () => ({
      record: async (entry) => {
        auditRecords.push(entry);
        return Result.ok(undefined);
      },
    }),
  );
  const event: HookEvent<"actions.requested"> = {
    data: {
      actions: [
        { callId: "call-1", input: { value: "one" }, kind: "tool-call", toolName: "known" },
        { callId: "call-2", input: {}, kind: "tool-call", toolName: "forged" },
      ],
      sequence: 1,
      stepIndex: 0,
      turnId: "turn-1",
    },
    meta: { at: "2026-01-01T00:00:00.000Z", id: "event-1" },
    type: "actions.requested",
  };

  await hook.events?.["actions.requested"]?.(event, context());

  expect(auditRecords).toHaveLength(1);
  expect(auditRecords[0]).toMatchObject({
    decision: "requested",
    delegate: "test",
    id: "event-1:call-1",
    input: { redacted: true },
    tool: "known",
  });
});
