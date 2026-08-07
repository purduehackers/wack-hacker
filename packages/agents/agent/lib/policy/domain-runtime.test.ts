import { describe, expect, test } from "bun:test";

import { DISCORD_IDS, UserRole, type UserRole as UserRoleValue } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { ApprovalContext, ToolContext } from "eve/tools";
import { z } from "zod";

import type { SecondPartyApprovalRecord } from "./approval-record.ts";
import type { ActionAuditRecord } from "./audit.ts";
import { createDomainRuntime, type DomainRuntimeDependencies } from "./domain-runtime.ts";
import { defineDomainTool } from "./domain-tools.ts";
import { Confirmation, RiskLevel } from "./types.ts";

function auth(role: UserRoleValue) {
  return {
    attributes: { role },
    authenticator: "domain-runtime-test",
    principalId: "10000000000000000",
    principalType: "user",
  };
}

function session(role: UserRoleValue) {
  const current = auth(role);
  return {
    id: "session-1",
    auth: { current, initiator: current },
    turn: { id: "turn-1", sequence: 0 },
  };
}

function approvalContext(
  role: UserRoleValue,
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): ApprovalContext {
  return {
    approvedTools: new Set(),
    callId: "call-1",
    getSandbox: async () => {
      throw new Error("no sandbox in policy test");
    },
    getSkill: () => {
      throw new Error("no skills in policy test");
    },
    session: session(role),
    toolInput,
    toolName,
  };
}

function toolContext(role: UserRoleValue, toolName: string): ToolContext {
  return {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    getSandbox: async () => {
      throw new Error("no sandbox in policy test");
    },
    getSkill: () => {
      throw new Error("no skills in policy test");
    },
    getToken: async () => {
      throw new Error("no auth provider in policy test");
    },
    requireAuth: () => {
      throw new Error("no auth provider in policy test");
    },
    session: session(role),
    toolName,
  };
}

function dependencies(auditRecords: ActionAuditRecord[]): DomainRuntimeDependencies {
  return {
    approval: {
      putSecondParty: async () => Result.ok(undefined),
      read: async () => Result.ok(undefined),
    },
    audit: {
      record: async (entry) => {
        auditRecords.push(entry);
        return Result.ok(undefined);
      },
    },
    budget: { read: async () => Result.ok({ used: 0, limit: 250_000 }) },
  };
}

// oxlint-disable-next-line oxclippy/too-many-lines -- the cases exercise one ordered policy lifecycle.
describe("central domain policy runtime", () => {
  test("derives names and descriptors from the registry and fails discovery closed", async () => {
    const auditRecords: ActionAuditRecord[] = [];
    const tools = {
      inspect: defineDomainTool({
        access: { risk: RiskLevel.Read },
        description: "Inspect",
        input: z.object({}),
        execute: async () => ({ ok: true }),
      }),
      mutate: defineDomainTool({
        access: { risk: RiskLevel.Write },
        description: "Mutate",
        input: z.object({}),
        execute: async () => ({ ok: true }),
      }),
    } as const;
    const runtime = createDomainRuntime(
      { domain: "test", label: "Test", service: "Test", tools },
      dependencies(auditRecords),
    );

    expect(runtime.isToolName("inspect")).toBeTrue();
    expect(runtime.isToolName("forged")).toBeFalse();
    expect(runtime.descriptorForTool("inspect")).toEqual({
      kind: "tool",
      minRole: UserRole.Public,
      name: "inspect",
      risk: RiskLevel.Read,
    });
    expect(runtime.descriptorForTool("mutate").minRole).toBe(UserRole.Organizer);
    // oxlint-disable-next-line unicorn/no-null -- Eve models absent current auth as null.
    expect(await runtime.visibleToolNames(null, Object.keys(tools))).toEqual([]);
    expect(await runtime.visibleToolNames(auth(UserRole.Public), Object.keys(tools))).toEqual([
      "inspect",
    ]);
  });

  test("keeps approval as a Requested audit owner", async () => {
    const auditRecords: ActionAuditRecord[] = [];
    const tools = {
      destroy: defineDomainTool({
        access: { risk: RiskLevel.Destructive },
        description: "Destroy",
        input: z.object({ id: z.string() }),
        execute: async () => ({ ok: true }),
      }),
    } as const;
    const runtime = createDomainRuntime(
      { domain: "test", label: "Test", service: "Test", tools },
      dependencies(auditRecords),
    );

    expect(
      await runtime.approvalForTool(
        "destroy",
        approvalContext(UserRole.Organizer, "destroy", { id: "1" }),
      ),
    ).toBe("user-approval");
    expect(auditRecords.map((entry) => entry.decision)).toEqual(["requested"]);
  });

  test("rebinds second-party execution to the requester and records the approver", async () => {
    const auditRecords: ActionAuditRecord[] = [];
    let policy: SecondPartyApprovalRecord | undefined;
    const baseDependencies = dependencies(auditRecords);
    const tools = {
      destroy: defineDomainTool({
        access: { risk: RiskLevel.Destructive, confirm: Confirmation.SecondParty },
        description: "Destroy",
        input: z.object({ id: z.string() }),
        execute: async ({ id }) => ({ id }),
      }),
    } as const;
    const runtime = createDomainRuntime(
      { domain: "test", label: "Test", service: "Test", tools },
      {
        ...baseDependencies,
        approval: {
          putSecondParty: async (_sessionId, _callId, record) => {
            policy = record;
            return Result.ok(undefined);
          },
          read: async () => Result.ok(policy),
        },
      },
    );

    expect(
      await runtime.approvalForTool(
        "destroy",
        approvalContext(UserRole.Organizer, "destroy", { id: "1" }),
      ),
    ).toBe("user-approval");

    const approverId = "10000000000000001";
    const requesterId = "10000000000000000";
    const executionContext = toolContext(UserRole.Organizer, "destroy");
    const approver = {
      ...auth(UserRole.Organizer),
      attributes: {
        approvalRequesterId: requesterId,
        approvalRequesterMemberRoles: [DISCORD_IDS.roles.ORGANIZER],
        role: UserRole.Organizer,
      },
      principalId: approverId,
    };
    expect(
      await runtime.executeTool(
        "destroy",
        { id: "1" },
        {
          ...executionContext,
          session: {
            ...executionContext.session,
            auth: { current: approver, initiator: approver },
          },
        },
      ),
    ).toEqual({ id: "1" });
    expect(auditRecords.map((entry) => entry.decision)).toEqual([
      "requested",
      "approved",
      "executed",
    ]);
    expect(auditRecords.at(-1)).toMatchObject({
      decidedBy: approverId,
      principal: { userId: requesterId },
    });
  });

  test("preserves readiness, validation, execution, projection, and audit ordering", async () => {
    const auditRecords: ActionAuditRecord[] = [];
    let configured = false;
    let executions = 0;
    const tools = {
      mutate: defineDomainTool({
        access: { risk: RiskLevel.Write, confirm: Confirmation.None },
        description: "Mutate",
        input: z.object({ id: z.string() }),
        execute: async ({ id }) => {
          executions += 1;
          return { id, token: "secret" };
        },
      }),
    } as const;
    const runtime = createDomainRuntime(
      {
        domain: "test",
        label: "Test",
        service: "Test",
        tools,
        configurationError: () =>
          configured
            ? undefined
            : new UpstreamError({
                service: "Test",
                status: 401,
                detail: "integration is not configured",
              }),
        projectAuditInput: (input) => ({ protected: input }),
        projectOutput: (output) => ({ protected: output }),
      },
      dependencies(auditRecords),
    );

    expect(
      await runtime.executeTool("mutate", {}, toolContext(UserRole.Organizer, "mutate")),
    ).toEqual({
      ok: false,
      error: {
        tag: "UpstreamError",
        message: "Test returned 401: integration is not configured",
      },
    });
    expect(executions).toBe(0);
    expect(auditRecords.map((entry) => entry.decision)).toEqual(["failed"]);

    configured = true;
    expect(
      await runtime.executeTool("mutate", {}, toolContext(UserRole.Organizer, "mutate")),
    ).toEqual({
      ok: false,
      error: { tag: "InvalidInput", message: "Invalid input: expected string, received undefined" },
    });
    expect(executions).toBe(0);
    expect(auditRecords.map((entry) => entry.decision)).toEqual(["failed"]);

    expect(
      await runtime.executeTool("mutate", { id: "1" }, toolContext(UserRole.Organizer, "mutate")),
    ).toEqual({ protected: { id: "1", token: "secret" } });
    expect(executions).toBe(1);
    expect(auditRecords.map((entry) => entry.decision)).toEqual(["failed", "executed"]);
    expect(auditRecords.at(-1)?.input).toEqual({ protected: { id: "1" } });
  });
});
