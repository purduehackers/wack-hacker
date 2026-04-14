import type { StepResult, ToolSet } from "ai";

import { tool } from "ai";
import { MockLanguageModelV3, MockProviderV3, simulateReadableStream } from "ai/test";
import { z } from "zod";

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
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    }),
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
