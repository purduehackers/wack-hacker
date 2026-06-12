import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { StepResult, ToolSet } from "ai";

import { tool } from "ai";
import { MockLanguageModelV3, MockProviderV3, simulateReadableStream } from "ai/test";
import { z } from "zod";

import { UserRole } from "@/lib/ai/constants";
import { AgentContext } from "@/lib/ai/context";
import { DISCORD_IDS } from "@/lib/protocol/constants";

import { messagePacket } from "./packets";

/**
 * Build an `AgentContext` whose `role` resolves to the requested tier by
 * populating `memberRoles` with the matching Discord role ID. Consolidates
 * the duplicate helpers that delegate/subagent/schedule tests used to
 * hand-roll.
 */
export function contextForRole(role: UserRole): AgentContext {
  const memberRoles =
    role === UserRole.Admin
      ? [DISCORD_IDS.roles.ADMIN]
      : role === UserRole.Organizer
        ? [DISCORD_IDS.roles.ORGANIZER]
        : [];
  return AgentContext.fromPacket(messagePacket("hello", { memberRoles }));
}

/** No-op AI SDK tool that returns its name when invoked. */
export function noopTool(name: string) {
  return tool({
    description: name,
    inputSchema: z.object({}),
    execute: async () => name,
  });
}

/**
 * Build a `MockLanguageModelV3` whose `doStream` emits one text delta then
 * finishes. Exposes call arguments via `model.doStreamCalls` for assertions.
 */
export function streamingTextModel(text: string) {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks,
      }),
    }),
  });
}

/** One model step that calls `toolName` and finishes with reason `tool-calls`. */
function toolCallStepStream(toolName: string, call: number, narration?: string) {
  const narrationChunks: LanguageModelV3StreamPart[] = narration
    ? [
        { type: "text-start", id: `t${call}` },
        { type: "text-delta", id: `t${call}`, delta: narration },
        { type: "text-end", id: `t${call}` },
      ]
    : [];
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    ...narrationChunks,
    { type: "tool-call", toolCallId: `call-${call}`, toolName, input: "{}" },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
  return {
    stream: simulateReadableStream<LanguageModelV3StreamPart>({
      initialDelayInMs: null,
      chunkDelayInMs: null,
      chunks,
    }),
  };
}

/**
 * Build a `MockLanguageModelV3` that issues one call to `toolName` per step
 * and never finishes with text — every step finishes with reason
 * `tool-calls`, so a `ToolLoopAgent` run only ends when its `stopWhen` cap
 * cuts the loop. Used to exercise step-cap exhaustion paths. Pass `narration`
 * to also emit assistant text before each tool call (mid-task narration).
 */
export function toolLoopingModel(toolName: string, options?: { narration?: string }) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      return toolCallStepStream(toolName, call, options?.narration);
    },
  });
}

/**
 * Build a `MockLanguageModelV3` whose first step completes normally with a
 * tool call and whose second `doStream` call throws. Exercises the SDK's
 * mid-run crash path, where errors surface as stream `error` chunks instead
 * of rejected promises once a step has completed.
 */
export function toolThenErrorModel(toolName: string, errorMessage = "provider exploded") {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call > 1) throw new Error(errorMessage);
      return toolCallStepStream(toolName, call);
    },
  });
}

/**
 * Override the AI SDK's default provider so string model IDs resolve to the
 * supplied mock. AI SDK checks `globalThis.AI_SDK_DEFAULT_PROVIDER` before
 * falling through to the Vercel AI Gateway.
 */
export function installMockProvider(model: MockLanguageModelV3) {
  (globalThis as unknown as { AI_SDK_DEFAULT_PROVIDER: unknown }).AI_SDK_DEFAULT_PROVIDER =
    new MockProviderV3({
      languageModels: new Proxy({}, { get: () => model }) as Record<string, MockLanguageModelV3>,
    });
}

export function uninstallMockProvider() {
  delete (globalThis as unknown as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER;
}

/**
 * Build a minimal `StepResult` for tests that scan step history. Only the
 * `toolCalls` shape matters for most consumers.
 */
export function stepResult(
  calls: Array<{ toolName: string; input?: unknown }>,
): StepResult<ToolSet> {
  return {
    toolCalls: calls.map((c, i) => ({
      toolCallId: `call-${i}`,
      toolName: c.toolName,
      input: c.input ?? {},
    })),
  } as unknown as StepResult<ToolSet>;
}
