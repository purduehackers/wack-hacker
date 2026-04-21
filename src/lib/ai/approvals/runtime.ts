import { tool, type Tool, type ToolSet } from "ai";
import { Routes } from "discord-api-types/v10";
import { log } from "evlog";
import { z } from "zod";

import type { ApprovalState, WrapApprovalOptions } from "./types.ts";

import { discord } from "../tools/discord/client.ts";
import { buildApprovalComponents, buildApprovalEmbed } from "./helpers.ts";
import { getApprovalOptions } from "./index.ts";
import { ApprovalStore } from "./store.ts";

const DEFAULT_TIMEOUT_MS = 240_000;

type RuntimeExecuteFn = (input: unknown, runtime: unknown) => unknown;

/**
 * Wrap every tool in a ToolSet that carries the approval marker. Unmarked
 * tools pass through unchanged. Pass `delegateName` from subagent call sites
 * so the approval prompt renders the full `delegate_<name>.<tool>(...)`
 * signature; omit it at the orchestrator layer.
 */
export function wrapApprovalTools(tools: ToolSet, opts: WrapApprovalOptions): ToolSet {
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const markerOpts = getApprovalOptions(t);
    out[name] = markerOpts ? wrapWithApproval(t as Tool, name, markerOpts, opts) : t;
  }
  return out;
}

function wrapWithApproval(
  original: Tool,
  toolName: string,
  markerOpts: { reason?: string },
  wrapOpts: WrapApprovalOptions,
): Tool {
  const timeoutMs = wrapOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staticReason = markerOpts.reason;

  const originalSchema = original.inputSchema as z.ZodTypeAny | undefined;
  const schemaToUse: z.ZodTypeAny =
    originalSchema instanceof z.ZodObject
      ? originalSchema.extend({
          _reason: z
            .string()
            .describe(
              "Short explanation of why this tool call is needed. Shown to the user for approval.",
            ),
        })
      : (originalSchema ?? z.object({}));

  const originalExecute = original.execute as RuntimeExecuteFn | undefined;

  return tool({
    description: `${original.description ?? ""}\n\n⚠️ Requires user approval before execution. You MUST include a concise \`_reason\` in your arguments explaining why this action is needed.`,
    inputSchema: schemaToUse,
    execute: async (rawInput: unknown, runtime: unknown) => {
      const context = wrapOpts.context;
      const channelId = context.channel.id;
      const threadId = context.thread?.id;
      const requesterUserId = context.userId;

      const { reason, toolInput } = extractReason(rawInput, staticReason);

      const approvalId = crypto.randomUUID();
      const store = wrapOpts.store ?? new ApprovalStore();
      const postMessage = wrapOpts.postMessage ?? defaultPostMessage;

      const state: ApprovalState = {
        id: approvalId,
        status: "pending",
        delegateName: wrapOpts.delegateName,
        toolName,
        input: toolInput,
        reason,
        channelId,
        threadId,
        requesterUserId,
        createdAt: new Date().toISOString(),
      };

      await store.create(state);

      const targetChannelId = threadId ?? channelId;
      const embed = buildApprovalEmbed({
        delegateName: wrapOpts.delegateName,
        toolName,
        input: toolInput,
        reason,
        timeoutMs,
      });
      const components = buildApprovalComponents(approvalId);

      try {
        const msg = await postMessage(targetChannelId, {
          content: `<@${requesterUserId}>`,
          embeds: [embed],
          components,
          allowed_mentions: { users: [requesterUserId], parse: [] },
        });
        await store.setMessageId(approvalId, msg.id);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "unknown error";
        log.error("approval", `Failed to send approval prompt: ${errorMessage}`);
        return `Approval prompt failed to send (${errorMessage}). The tool was NOT run.`;
      }

      const abortSignal = extractAbortSignal(runtime);
      const final = await store.waitFor(approvalId, { timeoutMs, signal: abortSignal });

      return runFinal({ final, originalExecute, toolInput, runtime, toolName });
    },
  });
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

async function runFinal(args: {
  final: ApprovalState;
  originalExecute: RuntimeExecuteFn | undefined;
  toolInput: Record<string, unknown>;
  runtime: unknown;
  toolName: string;
}): Promise<unknown> {
  const { final, originalExecute, toolInput, runtime, toolName } = args;

  if (final.status === "approved") {
    if (!originalExecute) {
      return `Tool \`${toolName}\` has no execute function; approval succeeded but nothing ran.`;
    }
    const result = originalExecute(toolInput, runtime);
    if (isAsyncIterable(result)) {
      let last: unknown = undefined;
      for await (const v of result) last = v;
      return last;
    }
    return await (result as Promise<unknown>);
  }

  return denialMessage(final.status, toolName);
}

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function denialMessage(status: ApprovalState["status"], toolName: string): string {
  if (status === "denied") {
    return `The user denied permission to run \`${toolName}\`. Do not retry this tool call.`;
  }
  if (status === "timeout") {
    return `The approval request for \`${toolName}\` timed out. Do not retry this tool call.`;
  }
  return `The approval for \`${toolName}\` is not approved (status: ${status}). Do not retry.`;
}

async function defaultPostMessage(
  channelId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  return (await discord.post(Routes.channelMessages(channelId), { body })) as { id: string };
}
