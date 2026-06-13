import { tool, type Tool, type ToolSet } from "ai";
import { Routes } from "discord-api-types/v10";
import { log } from "evlog";
import { z } from "zod";

import type { ActionAuditEntry, AuditLogLike } from "../policy/types.ts";
import type {
  ApprovalPolicy,
  ApprovalState,
  ApprovalStoreLike,
  WrapApprovalOptions,
} from "./types.ts";

import { discord } from "../tools/discord/client.ts";
import { buildApprovalComponents, buildApprovalEmbed, buildDecisionEmbed } from "./helpers.ts";
import { getApprovalOptions } from "./index.ts";
import { ApprovalStore } from "./store.ts";

const DEFAULT_TIMEOUT_MS = 240_000;
const TTL_BUFFER_SECONDS = 60;

type RuntimeExecuteFn = (input: unknown, runtime: unknown) => unknown;

/**
 * Wrap every tool in a ToolSet that carries the approval marker. Unmarked
 * tools pass through unchanged. Pass `delegateName` from subagent call sites
 * so the approval prompt renders the full `delegate_<name>.<tool>(...)`
 * signature; omit it at the orchestrator layer.
 *
 * Legacy entry point — `applyPolicy` resolves an `access()` descriptor into
 * an `ApprovalPolicy` and calls `wrapToolWithApproval` directly.
 */
export function wrapApprovalTools(tools: ToolSet, opts: WrapApprovalOptions): ToolSet {
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const markerOpts = getApprovalOptions(t);
    out[name] = markerOpts
      ? wrapToolWithApproval(
          t as Tool,
          name,
          { confirmMode: "self", risk: "write", reason: markerOpts.reason },
          opts,
        )
      : t;
  }
  return out;
}

function buildWrappedSchema(
  originalSchema: z.ZodTypeAny | undefined,
  staticReason: string | undefined,
): z.ZodTypeAny {
  const description = staticReason
    ? "Short explanation of why this tool call is needed. Shown to the user for approval. Optional — falls back to the configured static reason when omitted."
    : "Short explanation of why this tool call is needed. Shown to the user for approval.";
  const reasonSchema = staticReason
    ? z.string().optional().describe(description)
    : z.string().describe(description);

  if (originalSchema === undefined) {
    return z.object({ _reason: reasonSchema });
  }
  if (originalSchema instanceof z.ZodObject) {
    return originalSchema.extend({ _reason: reasonSchema });
  }
  // Silently passing a non-object schema through would mean `_reason` never
  // lands in the schema and `extractReason` would drop whatever primitive /
  // array / union input the agent actually sent. Fail fast at wrap time so
  // the misconfiguration is caught in tests, not at runtime.
  throw new Error(
    "approval() can only be applied to tools with a ZodObject inputSchema (or no inputSchema).",
  );
}

function buildWrappedDescription(
  originalDescription: string | undefined,
  staticReason: string | undefined,
): string {
  const note = staticReason
    ? "⚠️ Requires user approval before execution. You may include a concise `_reason`; when omitted, the tool's configured static reason is used."
    : "⚠️ Requires user approval before execution. You MUST include a concise `_reason` in your arguments explaining why this action is needed.";
  return `${originalDescription ?? ""}\n\n${note}`;
}

async function postApprovalMessage(args: {
  channelId: string;
  requesterUserId: string;
  embed: ReturnType<typeof buildApprovalEmbed>;
  components: ReturnType<typeof buildApprovalComponents>;
}): Promise<{ id: string }> {
  const { channelId, requesterUserId, embed, components } = args;
  return (await discord.post(Routes.channelMessages(channelId), {
    body: {
      content: `<@${requesterUserId}>`,
      embeds: [embed],
      components,
      allowed_mentions: { users: [requesterUserId], parse: [] },
    },
  })) as { id: string };
}

/**
 * Best-effort swap of the original approval embed for the terminal decision
 * embed (green / red / grey) and remove the buttons. Called from the wrapper
 * when the approval resolves to a non-approved status so the channel UI
 * converges to what's stored — especially the timeout path, which otherwise
 * leaves the prompt amber with live buttons indefinitely.
 */
async function convergeApprovalMessage(state: ApprovalState): Promise<void> {
  if (!state.messageId || state.status === "pending" || state.status === "approved") return;
  const channelId = state.threadId ?? state.channelId;
  try {
    await discord.patch(Routes.channelMessage(channelId, state.messageId), {
      body: {
        embeds: [buildDecisionEmbed(state, state.status, state.decidedByUserId ?? null)],
        components: [],
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    log.warn(
      "approval",
      `Failed to converge approval message ${state.messageId} to ${state.status}: ${message}`,
    );
  }
}

async function* runApproved(
  originalExecute: RuntimeExecuteFn | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  runtime: unknown,
): AsyncGenerator<unknown> {
  if (!originalExecute) {
    yield `Tool \`${toolName}\` has no execute function; approval succeeded but nothing ran.`;
    return;
  }
  const result = originalExecute(toolInput, runtime);
  if (isAsyncIterable(result)) {
    for await (const v of result) yield v;
    return;
  }
  yield await (result as Promise<unknown>);
}

/**
 * Wrap one tool with the Discord Approve/Deny flow. The wrapper posts the
 * prompt, waits for the button decision (or timeout), and only then runs the
 * original execute. When `wrapOpts.audit` is provided, the full lifecycle is
 * recorded durably: requested → approved/denied/timeout, plus executed/failed
 * for destructive tools.
 */
export function wrapToolWithApproval(
  original: Tool,
  toolName: string,
  policy: ApprovalPolicy,
  wrapOpts: WrapApprovalOptions,
): Tool {
  const timeoutMs = wrapOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttlSeconds = Math.ceil(timeoutMs / 1000) + TTL_BUFFER_SECONDS;
  const staticReason = policy.reason;
  const schemaToUse = buildWrappedSchema(
    original.inputSchema as z.ZodTypeAny | undefined,
    staticReason,
  );
  const originalExecute = original.execute as RuntimeExecuteFn | undefined;

  return tool({
    description: buildWrappedDescription(original.description, staticReason),
    inputSchema: schemaToUse,
    execute: async function* (rawInput: unknown, runtime: unknown) {
      const { context, delegateName, audit } = wrapOpts;
      const channelId = context.channel.id;
      const threadId = context.thread?.id;
      const requesterUserId = context.userId;
      const { reason, toolInput } = extractReason(rawInput, staticReason);

      const auditBase: Omit<ActionAuditEntry, "decision"> = {
        userId: requesterUserId,
        role: context.role,
        source: context.source,
        delegate: delegateName,
        tool: toolName,
        risk: policy.risk,
        input: toolInput,
        reason,
      };

      const approvalId = crypto.randomUUID();
      const store = wrapOpts.store ?? new ApprovalStore();
      const state: ApprovalState = {
        id: approvalId,
        status: "pending",
        delegateName,
        toolName,
        input: toolInput,
        reason,
        channelId,
        threadId,
        requesterUserId,
        confirmMode: policy.confirmMode,
        createdAt: new Date().toISOString(),
      };
      await store.create(state, ttlSeconds);
      await audit?.record({ ...auditBase, decision: "requested" });

      const promptError = await postApprovalPrompt({ state, store, ttlSeconds, timeoutMs });
      if (promptError) {
        // Terminal row so the `requested` entry doesn't dangle unresolved —
        // the user never saw a prompt and the tool never ran.
        await audit?.record({ ...auditBase, decision: "failed" });
        yield promptError;
        return;
      }

      const abortSignal = extractAbortSignal(runtime);
      const final = await store.waitFor(approvalId, { timeoutMs, signal: abortSignal });
      if (final.status !== "approved") {
        await convergeApprovalMessage(final);
        await audit?.record({
          ...auditBase,
          decision: final.status === "denied" ? "denied" : "timeout",
          decidedBy: final.decidedByUserId,
        });
        yield denialMessage(final.status, toolName);
        return;
      }
      await audit?.record({
        ...auditBase,
        decision: "approved",
        decidedBy: final.decidedByUserId,
      });

      yield* runApprovedWithAudit({
        originalExecute,
        toolName,
        toolInput,
        runtime,
        destructive: policy.risk === "destructive",
        audit,
        auditBase,
      });
    },
  });
}

/**
 * Post the Approve/Deny prompt and persist its message id. Returns the
 * model-facing error string when the prompt could not be sent (the tool must
 * NOT run in that case), or null on success.
 */
async function postApprovalPrompt(args: {
  state: ApprovalState;
  store: ApprovalStoreLike;
  ttlSeconds: number;
  timeoutMs: number;
}): Promise<string | null> {
  const { state, store, ttlSeconds, timeoutMs } = args;
  try {
    const msg = await postApprovalMessage({
      channelId: state.threadId ?? state.channelId,
      requesterUserId: state.requesterUserId,
      embed: buildApprovalEmbed({
        delegateName: state.delegateName,
        toolName: state.toolName,
        input: state.input,
        reason: state.reason,
        timeoutMs,
        confirmMode: state.confirmMode,
      }),
      components: buildApprovalComponents(state.id),
    });
    await store.setMessageId(state.id, msg.id, ttlSeconds);
    return null;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "unknown error";
    log.error("approval", `Failed to send approval prompt: ${errorMessage}`);
    return `Approval prompt failed to send (${errorMessage}). The tool was NOT run.`;
  }
}

/**
 * Run the approved tool, appending executed/failed audit rows for destructive
 * tools. Non-destructive (or unaudited) runs delegate straight through.
 */
async function* runApprovedWithAudit(args: {
  originalExecute: RuntimeExecuteFn | undefined;
  toolName: string;
  toolInput: Record<string, unknown>;
  runtime: unknown;
  destructive: boolean;
  audit: AuditLogLike | undefined;
  auditBase: Omit<ActionAuditEntry, "decision">;
}): AsyncGenerator<unknown> {
  const { originalExecute, toolName, toolInput, runtime, destructive, audit, auditBase } = args;
  if (!destructive || !audit) {
    yield* runApproved(originalExecute, toolName, toolInput, runtime);
    return;
  }
  try {
    yield* runApproved(originalExecute, toolName, toolInput, runtime);
  } catch (err: unknown) {
    await audit.record({ ...auditBase, decision: "failed" });
    throw err;
  }
  await audit.record({ ...auditBase, decision: "executed" });
}

function extractReason(
  raw: unknown,
  staticReason: string | undefined,
): { reason: string; toolInput: Record<string, unknown> } {
  if (!raw || typeof raw !== "object") {
    return { reason: staticReason ?? "(not provided)", toolInput: {} };
  }
  const obj = { ...(raw as Record<string, unknown>) };
  const supplied = typeof obj._reason === "string" ? obj._reason.trim() : "";
  delete obj._reason;
  return {
    reason: supplied || staticReason || "(not provided)",
    toolInput: obj,
  };
}

function extractAbortSignal(runtime: unknown): AbortSignal | undefined {
  if (!runtime || typeof runtime !== "object") return undefined;
  const sig = (runtime as { abortSignal?: unknown }).abortSignal;
  return sig instanceof AbortSignal ? sig : undefined;
}

/** Shared with `applyPolicy`'s destructive-execution wrapper. */
export function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function denialMessage(
  status: Exclude<ApprovalState["status"], "approved">,
  toolName: string,
): string {
  if (status === "denied") {
    return `The user denied permission to run \`${toolName}\`. Do not retry this tool call.`;
  }
  // status is narrowed to "timeout" — the wrapper only calls this for
  // terminal non-approved states produced by `waitFor()`.
  return `The approval request for \`${toolName}\` timed out. Do not retry this tool call.`;
}
