import { DISCORD_IDS, UserRole } from "@repo/shared/discord";
import type { SessionAuthContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import type { ApprovalContext, ApprovalResponseContext } from "eve/tools/approval";

export function principal(
  role: UserRole = UserRole.Organizer,
  id = "requester",
): SessionAuthContext {
  return {
    authenticator: "discord",
    principalId: id,
    principalType: "user",
    attributes: {
      role: UserRole.Admin,
      memberRoles:
        role === UserRole.Admin
          ? [DISCORD_IDS.roles.ADMIN]
          : role === UserRole.Organizer
            ? [DISCORD_IDS.roles.ORGANIZER]
            : [],
    },
  };
}

export function toolContext(
  current = principal(),
  responder?: SessionAuthContext,
  toolName = "fixture__read",
): ToolContext {
  return {
    session: {
      id: "catalog-test",
      auth: { current, initiator: current },
      turn: { id: "turn-1", sequence: 1 },
    },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName,
    messages: [],
    getSandbox: async () => {
      throw new Error("Unexpected sandbox allocation");
    },
    getToken: async () => {
      throw new Error("Unexpected user account connection");
    },
    requireAuth: () => {
      throw new Error("Unexpected user account connection");
    },
    ...(responder === undefined
      ? {}
      : {
          approval: {
            responder: {
              ...responder,
              getToken: async () => {
                throw new Error("Unexpected responder account connection");
              },
            },
          },
        }),
  };
}

export function approvalContext(toolName: string, current = principal()): ApprovalContext {
  return { ...toolContext(current, undefined, toolName), approvedTools: new Set(), toolInput: {} };
}

export function responseContext(
  toolName: string,
  responder = principal(),
  requester = principal(),
): ApprovalResponseContext {
  const ctx = toolContext(requester);
  return {
    auth: {
      getToken: (provider, options) => ctx.getToken(provider, options),
      requireAuth: (provider, options) => ctx.requireAuth(provider, options),
    },
    session: { id: ctx.session.id, initiator: requester, turn: ctx.session.turn },
    request: {
      callId: ctx.callId,
      requestId: "request-1",
      principal: requester,
      toolName,
      toolInput: {},
    },
    response: { decision: "approve", principal: responder },
  };
}
