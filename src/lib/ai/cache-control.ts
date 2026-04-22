import type { JSONValue, LanguageModel, ModelMessage, ToolSet } from "ai";

/**
 * Anthropic prompt caching helper, reusable across every subagent that runs
 * on a Claude model. Ported from open-agents (`packages/agent/context-management/cache-control.ts`)
 * so each step pays full input cost only once per cache window — the tools
 * block and the system prompt become eligible for cache hits on subsequent
 * steps in the same turn. For non-Anthropic models (e.g. the default
 * `openai/gpt-5.4-mini` subagent) this is a no-op; callers can invoke it
 * unconditionally.
 */

type ProviderOptions = Record<string, Record<string, JSONValue>>;

const DEFAULT_CACHE_CONTROL_OPTIONS: ProviderOptions = {
  anthropic: { cacheControl: { type: "ephemeral" } },
};

export function isAnthropicModel(model: LanguageModel): boolean {
  if (typeof model === "string") {
    return model.includes("anthropic") || model.includes("claude");
  }
  return (
    model.provider === "anthropic" ||
    model.provider.includes("anthropic") ||
    model.modelId.includes("anthropic") ||
    model.modelId.includes("claude")
  );
}

export function addCacheControl<T extends ToolSet>(options: {
  tools: T;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}): T;

export function addCacheControl(options: {
  messages: ModelMessage[];
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}): ModelMessage[];

export function addCacheControl<T extends ToolSet>({
  tools,
  messages,
  model,
  providerOptions = DEFAULT_CACHE_CONTROL_OPTIONS,
}: {
  tools?: T;
  messages?: ModelMessage[];
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}): T | ModelMessage[] {
  if (!isAnthropicModel(model)) {
    return (tools ?? messages)!;
  }

  if (tools !== undefined) {
    const entries = Object.entries(tools);
    if (entries.length === 0) return tools;
    // Anthropic supports max 4 cache breakpoints per request. Marking only
    // the last tool keeps us within budget when combined with message caching.
    const lastIndex = entries.length - 1;
    return Object.fromEntries(
      entries.map(([name, entry], index) => [
        name,
        index === lastIndex
          ? {
              ...entry,
              providerOptions: {
                ...(entry as { providerOptions?: ProviderOptions }).providerOptions,
                ...providerOptions,
              },
            }
          : entry,
      ]),
    ) as T;
  }

  if (messages !== undefined) {
    if (messages.length === 0) return messages;
    // Per Anthropic docs: mark the final block of the final message so the
    // conversation caches incrementally across steps.
    return messages.map((message, index) =>
      index === messages.length - 1
        ? {
            ...message,
            providerOptions: {
              ...message.providerOptions,
              ...providerOptions,
            },
          }
        : message,
    );
  }

  throw new Error("addCacheControl: either tools or messages must be provided");
}
