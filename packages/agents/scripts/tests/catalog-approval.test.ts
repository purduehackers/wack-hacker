import "./fixtures/catalog-environment.ts";
import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";

import { DISCORD_IDS, UserRole } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { InputRequest } from "eve/client";
import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

import { applyInputRequests } from "../../agent/lib/discord/input-requests.ts";
import { initialDiscordState } from "../../agent/lib/discord/state.ts";
import {
  ApprovalPolicyStore,
  type SecondPartyApprovalRecord,
} from "../../agent/lib/policy/approval-record.ts";
import { AuditStore } from "../../agent/lib/policy/audit.ts";
import { createDomainRuntime } from "../../agent/lib/policy/domain-runtime.ts";
import { defineDomainTool } from "../../agent/lib/policy/domain-tools.ts";
import { Confirmation, RiskLevel } from "../../agent/lib/policy/types.ts";
import {
  parkOnApprovals,
  stepForRequest,
} from "../../node_modules/eve/dist/src/harness/hitl/approvals.js";
import {
  sessionView,
  saveTransition,
} from "../../node_modules/eve/dist/src/harness/session-machine/commit.js";
import { storedProjection } from "../../node_modules/eve/dist/src/harness/session-machine/view.js";
import {
  approvalContext,
  principal,
  responseContext,
  toolContext,
} from "./fixtures/catalog-context.ts";

const records = new Map<string, SecondPartyApprovalRecord>();
const audit = spyOn(AuditStore.prototype, "record").mockImplementation(async () =>
  Result.ok(undefined),
);
const storeWrite = spyOn(ApprovalPolicyStore.prototype, "putSecondParty").mockImplementation(
  async (session, call, record) => {
    records.set(`${session}:${call}`, structuredClone(record));
    return Result.ok(undefined);
  },
);
const storeRead = spyOn(ApprovalPolicyStore.prototype, "read").mockImplementation(
  async (session, call) => Result.ok(records.get(`${session}:${call}`)),
);
afterAll(() => {
  audit.mockRestore();
  storeWrite.mockRestore();
  storeRead.mockRestore();
});
let providerCalls = 0;
beforeEach(() => {
  records.clear();
  providerCalls = 0;
  audit.mockClear();
});

const execute = async () => {
  providerCalls += 1;
  return { ok: true };
};
const input = z.strictObject({});
const runtime = createDomainRuntime({
  domain: "fixture",
  label: "fixture",
  service: "fixture",
  tools: {
    read: defineDomainTool({
      description: "Read",
      input,
      access: { risk: RiskLevel.Read },
      execute,
    }),
    self: defineDomainTool({
      description: "Destructive",
      input,
      access: { risk: RiskLevel.Destructive },
      execute,
    }),
    pair: defineDomainTool({
      description: "Second party",
      input,
      access: { risk: RiskLevel.Destructive, confirm: Confirmation.SecondParty },
      execute,
    }),
    admin: defineDomainTool({
      description: "Admin read",
      input,
      access: { risk: RiskLevel.Read, minRole: UserRole.Admin },
      execute,
    }),
    configured: defineDomainTool({
      description: "Configured read",
      input,
      access: { risk: RiskLevel.Read },
      requires: "FIXTURE_KEY",
      execute,
    }),
  },
});

function secondParty(
  requesterRole: UserRole = UserRole.Organizer,
  approverRole: UserRole = UserRole.Organizer,
): SessionAuthContext {
  const actor = principal(approverRole, "approver");
  return {
    ...actor,
    attributes: {
      ...actor.attributes,
      approvalRequesterId: "requester",
      approvalRequesterMemberRoles:
        requesterRole === UserRole.Organizer ? [DISCORD_IDS.roles.ORGANIZER] : [],
    },
  };
}

test("read tools retain the original organizer admission floor at discovery and direct execution", async () => {
  expect(runtime.descriptorForTool("read").minRole).toBe(UserRole.Organizer);
  expect(await runtime.visibleToolNames(principal(UserRole.Public), ["read", "admin"])).toEqual([]);
  expect(await runtime.visibleToolNames(principal(), ["read", "admin"])).toEqual(["read"]);
  expect(
    await runtime.executeTool("read", {}, toolContext(principal(UserRole.Public))),
  ).toMatchObject({ ok: false, error: { tag: "Forbidden" } });
  expect(
    await runtime.approvalForTool(
      "read",
      approvalContext("fixture__read", principal(UserRole.Public)),
    ),
  ).toMatchObject({ type: "denied" });
  expect(providerCalls).toBe(0);
  expect(await runtime.executeTool("read", {}, toolContext())).toEqual({ ok: true });
  expect(providerCalls).toBe(1);
});

test("a crafted call cannot skip a required approval", async () => {
  for (const name of ["self", "pair"] as const) {
    expect(
      await runtime.executeTool(name, {}, toolContext(principal(), undefined, `fixture__${name}`)),
    ).toMatchObject({ ok: false, error: { tag: "Forbidden" } });
  }
  expect(providerCalls).toBe(0);
});

test("self approval uses the responder's fresh role and cannot be taken by someone else", async () => {
  expect(await runtime.approvalForTool("self", approvalContext("fixture__self"))).toBe(
    "user-approval",
  );
  expect(
    await runtime.approvalResponseForTool(
      "self",
      responseContext("fixture__self", principal(UserRole.Public)),
    ),
  ).toMatchObject({ status: "rejected" });
  expect(
    await runtime.approvalResponseForTool(
      "self",
      responseContext("fixture__self", principal(UserRole.Admin, "other")),
    ),
  ).toMatchObject({ status: "rejected" });
  expect(
    await runtime.executeTool(
      "self",
      {},
      toolContext(principal(), principal(UserRole.Public), "fixture__self"),
    ),
  ).toMatchObject({ ok: false });
  expect(providerCalls).toBe(0);
  expect(await runtime.approvalResponseForTool("self", responseContext("fixture__self"))).toEqual({
    status: "allowed",
  });
  expect(
    await runtime.executeTool("self", {}, toolContext(principal(), principal(), "fixture__self")),
  ).toEqual({ ok: true });
});

test("second-party approval remains parked after requester or approver demotion", async () => {
  expect(await runtime.approvalForTool("pair", approvalContext("fixture__pair"))).toBe(
    "user-approval",
  );
  for (const responder of [
    principal(),
    secondParty(UserRole.Public),
    secondParty(UserRole.Organizer, UserRole.Public),
  ]) {
    expect(
      await runtime.approvalResponseForTool("pair", responseContext("fixture__pair", responder)),
    ).toMatchObject({ status: "rejected" });
    expect(
      await runtime.executeTool("pair", {}, toolContext(principal(), responder, "fixture__pair")),
    ).toMatchObject({ ok: false });
  }
  expect(providerCalls).toBe(0);
  const responder = secondParty();
  expect(
    await runtime.approvalResponseForTool("pair", responseContext("fixture__pair", responder)),
  ).toEqual({ status: "allowed" });
  expect(
    await runtime.executeTool("pair", {}, toolContext(principal(), responder, "fixture__pair")),
  ).toEqual({ ok: true });
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      decision: "approved",
      decidedBy: "approver",
      principal: expect.objectContaining({ userId: "requester" }),
    }),
  );
});

test("approval records bind the exact namespace and call, retaining legacy bare names", async () => {
  await runtime.approvalForTool("pair", approvalContext("fixture__pair"));
  expect(records.get("catalog-test:call-1")?.tool).toBe("fixture__pair");
  const ctx = responseContext("other__pair", secondParty());
  expect(await runtime.approvalResponseForTool("pair", ctx)).toMatchObject({ status: "rejected" });
  expect(
    await runtime.approvalResponseForTool("pair", {
      ...ctx,
      request: { ...ctx.request, toolName: "fixture__pair", callId: "other-call" },
    }),
  ).toMatchObject({ status: "rejected" });
  await runtime.approvalForTool("pair", approvalContext("pair"));
  expect(
    await runtime.approvalResponseForTool("pair", responseContext("pair", secondParty())),
  ).toEqual({ status: "allowed" });
});

test("the requester can cancel after demotion without allowing execution", async () => {
  const ctx = responseContext("fixture__pair", principal(UserRole.Public));
  expect(
    await runtime.approvalResponseForTool("pair", {
      ...ctx,
      response: { ...ctx.response, decision: "cancel" },
    }),
  ).toEqual({ status: "allowed" });
  expect(providerCalls).toBe(0);
});

test("missing organization credentials return an actionable configuration error without account connection", async () => {
  expect(
    await runtime.executeTool(
      "configured",
      {},
      toolContext(principal(), undefined, "fixture__configured"),
    ),
  ).toMatchObject({
    ok: false,
    error: { tag: "UpstreamError", message: "fixture returned 401: FIXTURE_KEY is not configured" },
  });
  expect(providerCalls).toBe(0);
});

test("native approval parking survives restoration and projects namespaced second-party Discord controls", async () => {
  await runtime.approvalForTool("pair", approvalContext("fixture__pair"));
  const request: InputRequest = {
    kind: "tool-approval",
    requestId: "request-1",
    prompt: "Approve operation",
    action: { kind: "tool-call", callId: "call-1", toolName: "fixture__pair", input: {} },
  };
  const transition = parkOnApprovals(sessionView(storedProjection(undefined), undefined), {
    event: { sequence: 1, stepIndex: 0, turnId: "turn-1" },
    messages: [],
    requests: [request],
    tasks: [],
    requester: principal(),
  });
  expect(transition.events).toContainEqual(expect.objectContaining({ type: "input.requested" }));
  const checkpoint = structuredClone(saveTransition({ state: {}, history: [] }, transition));
  const restored = sessionView(storedProjection(checkpoint.state), checkpoint.state);
  expect(stepForRequest(restored, request.requestId)?.requester).toEqual(principal());
  const state = initialDiscordState();
  await applyInputRequests({
    state,
    requests: [request],
    userId: "requester",
    sessionId: "catalog-test",
    approvalPolicies: {
      read: async (session, call) => Result.ok(records.get(`${session}:${call}`)),
    },
  });
  expect(state.renderInputRequests).toMatchObject([
    {
      toolName: "fixture__pair",
      approvalMode: "second-party",
      approverMinRole: UserRole.Organizer,
    },
  ]);
  expect(
    await runtime.approvalResponseForTool(
      "pair",
      responseContext("fixture__pair", secondParty(UserRole.Public)),
    ),
  ).toMatchObject({ status: "rejected" });
  expect(stepForRequest(restored, request.requestId)?.requests).toEqual([request]);
  expect(providerCalls).toBe(0);
});
