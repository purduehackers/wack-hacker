import { Result } from "@repo/shared/result";
import { sliceText } from "@repo/shared/text";
import type { RenderInputRequest } from "@repo/shared/wire";
import type { InputRequest } from "eve/client";
import { z } from "zod";

import type { ApprovalPolicyStore } from "../policy/approval-record.ts";
import { isString, type JsonObject, type JsonValue } from "../serialization.ts";
import type { DiscordChannelState } from "./state.ts";

const SENSITIVE_INPUT_KEY = /secret|token|password|credential|api_key|auth|^value$/iu;

// Hoisted so the recursive walk reuses one schema instead of rebuilding it at
// every node.
const objectSchema = z.object({});

/**
 * `z.object({})` accepts exactly `typeof value === "object" && value !== null &&
 * !Array.isArray(value)`. Arrays already returned above, so this covers the same
 * values the old `typeof value === "object" && value !== null` test did, and
 * leaves `null`, booleans and every number — `NaN` and the infinities included —
 * to be handed back untouched.
 */
function isJsonObject(value: JsonValue): value is JsonObject {
  return objectSchema.safeParse(value).success;
}

function visiblePrompt(value: string): string {
  const prompt = sliceText(value.trim(), 2_000);
  return prompt === "" ? "Input required." : prompt;
}

function redactInput(value: JsonValue, depth = 0): JsonValue {
  if (depth >= 6) return "[truncated]";
  if (isString(value)) return sliceText(value, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactInput(item, depth + 1));
  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, item]) => [
        sliceText(key, 128),
        SENSITIVE_INPUT_KEY.test(key) ? "[redacted]" : redactInput(item, depth + 1),
      ]),
  );
}

function inputPreview(value: JsonValue): string | undefined {
  const serialized = JSON.stringify(redactInput(value), undefined, 2);
  if (serialized === undefined || serialized === "{}") return undefined;
  return sliceText(serialized.replaceAll("```", "` ` `"), 2_000);
}

function approvalDisplay(
  request: InputRequest,
): Pick<RenderInputRequest, "inputPreview" | "toolName"> {
  if (request.kind !== "tool-approval") return {};
  const preview = inputPreview(request.action.input);
  return {
    toolName: sliceText(request.action.toolName, 256),
    ...(preview === undefined ? {} : { inputPreview: preview }),
  };
}

interface ApplyInputRequestsDeps {
  readonly state: Pick<
    DiscordChannelState,
    "answeredInputRequestIds" | "pendingInputRequestIds" | "renderInputRequests"
  >;
  readonly requests: readonly InputRequest[];
  readonly userId: string | undefined;
  readonly sessionId: string;
  readonly approvalPolicies: Pick<ApprovalPolicyStore, "read">;
}

/**
 * Resolves every request before mutating channel state. A policy-store failure,
 * missing second-party record, or identity mismatch therefore fails closed and
 * leaves previously rendered controls intact for a later durable replay.
 */
export async function applyInputRequests(deps: ApplyInputRequestsDeps): Promise<void> {
  const { state, userId } = deps;
  if (userId === undefined) throw new Error("input request has no authenticated recipient");
  const answered = new Set(state.answeredInputRequestIds);
  const candidates = await Promise.all(
    deps.requests
      .filter(
        ({ requestId }) =>
          !answered.has(requestId) && requestId.length > 0 && requestId.length <= 512,
      )
      .map(async (request): Promise<RenderInputRequest> => {
        let approvalPolicy: Pick<RenderInputRequest, "approvalMode" | "approverMinRole"> = {};
        if (request.kind === "tool-approval") {
          const policy = await deps.approvalPolicies.read(deps.sessionId, request.action.callId);
          if (Result.isError(policy)) throw policy.error;
          // Absent means self-approval, not tampering. Only `requestSecondPartyApproval`
          // writes a record, because a record exists to bind *another* person to a
          // request they did not make. A `Confirmation.Self` approval has no second
          // party, so there is nothing to store and nothing to verify — the approver
          // is the requester, and `userId` below already says who that is.
          //
          // Requiring one unconditionally threw for every self-approval, which
          // failed the whole batch and rendered no control at all. `schedule_task`
          // asked for approval, Discord showed a truncated sentence and no button,
          // and the scheduled task could never be approved.
          if (policy.value !== undefined) {
            if (
              policy.value.requesterUserId !== userId ||
              policy.value.tool !== request.action.toolName
            ) {
              throw new Error("tool approval policy does not match the pending request");
            }
            approvalPolicy = {
              approvalMode: policy.value.mode,
              approverMinRole: policy.value.minApproverRole,
            };
          }
        }
        return {
          requestId: request.requestId,
          recipientUserId: userId,
          prompt: visiblePrompt(request.prompt),
          kind: request.kind,
          ...approvalDisplay(request),
          ...approvalPolicy,
          ...(request.display === undefined ? {} : { display: request.display }),
          ...(request.allowFreeform === undefined ? {} : { allowFreeform: request.allowFreeform }),
          ...(request.options === undefined
            ? {}
            : {
                options: request.options
                  .filter(({ id }) => id.length > 0 && id.length <= 512)
                  .slice(0, 100)
                  .map((option) => ({
                    id: option.id,
                    label: sliceText(visiblePrompt(option.label), 256),
                    ...(option.description === undefined
                      ? {}
                      : { description: sliceText(option.description, 1_000) }),
                    ...(option.style === undefined ? {} : { style: option.style }),
                  })),
              }),
        };
      }),
  );
  const normalized = candidates.sort(
    (left, right) => Number(left.kind === "question") - Number(right.kind === "question"),
  );

  const byId = new Map(state.renderInputRequests.map((request) => [request.requestId, request]));
  for (const request of normalized) byId.set(request.requestId, request);
  state.renderInputRequests = [...byId.values()];
  state.pendingInputRequestIds = [
    ...new Set([...state.pendingInputRequestIds, ...normalized.map(({ requestId }) => requestId)]),
  ];
}
