import { describe, expect, test } from "bun:test";

import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { InputRequest } from "eve/client";

import { applyInputRequests } from "./input-requests.ts";
import { initialDiscordState } from "./state.ts";

const approval: InputRequest = {
  requestId: "approval-1",
  kind: "tool-approval",
  prompt: "Approve deleting the project?",
  action: {
    kind: "tool-call",
    callId: "call-1",
    toolName: "delete_project",
    input: { projectId: "project-1" },
  },
  display: "confirmation",
  options: [
    { id: "approve", label: "Approve", style: "primary" },
    { id: "deny", label: "Deny", style: "danger" },
  ],
};

function seededState() {
  const state = initialDiscordState();
  state.pendingInputRequestIds = ["question-existing"];
  state.renderInputRequests = [
    {
      requestId: "question-existing",
      recipientUserId: "10000000000000000",
      prompt: "Existing question",
      kind: "question",
      allowFreeform: true,
    },
  ];
  return state;
}

describe("Discord pending input projection", () => {
  test("a Redis policy-read failure fails closed without mutating existing controls", async () => {
    const state = seededState();
    const before = structuredClone(state);
    const unavailable = new Transient({ operation: "read policy", detail: "Redis unavailable" });

    expect(
      applyInputRequests({
        state,
        requests: [approval],
        userId: "10000000000000000",
        sessionId: "session-1",
        approvalPolicies: { read: async () => Result.err(unavailable) },
      }),
    ).rejects.toBe(unavailable);
    expect(state).toEqual(before);
  });

  test("a missing durable approval policy is an invariant failure and leaves controls intact", async () => {
    const state = seededState();
    const before = structuredClone(state);

    expect(
      applyInputRequests({
        state,
        requests: [approval],
        userId: "10000000000000000",
        sessionId: "session-1",
        approvalPolicies: { read: async () => Result.ok(undefined) },
      }),
    ).rejects.toThrow("tool approval policy is unavailable");
    expect(state).toEqual(before);
  });

  test("projects a matching second-party policy only after the whole batch resolves", async () => {
    const state = seededState();

    await applyInputRequests({
      state,
      requests: [approval],
      userId: "10000000000000000",
      sessionId: "session-1",
      approvalPolicies: {
        read: async () =>
          Result.ok({
            requesterUserId: "10000000000000000",
            mode: "second-party",
            minApproverRole: "admin",
            tool: "delete_project",
            risk: "destructive",
          }),
      },
    });

    expect(state.pendingInputRequestIds).toEqual(["question-existing", "approval-1"]);
    expect(state.renderInputRequests[1]).toMatchObject({
      requestId: "approval-1",
      recipientUserId: "10000000000000000",
      approvalMode: "second-party",
      approverMinRole: "admin",
      toolName: "delete_project",
    });
  });
});
