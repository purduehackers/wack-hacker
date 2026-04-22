import type { LanguageModel, ModelMessage, ToolSet } from "ai";

import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { addCacheControl, isAnthropicModel } from "./cache-control.ts";

function fakeAnthropicModel(): LanguageModel {
  return { provider: "anthropic", modelId: "claude-opus-4.7" } as unknown as LanguageModel;
}

function fakeOpenAIModel(): LanguageModel {
  return { provider: "openai", modelId: "gpt-5.4-mini" } as unknown as LanguageModel;
}

describe("isAnthropicModel", () => {
  it("detects via provider string id", () => {
    expect(isAnthropicModel("anthropic/claude-opus-4.7")).toBe(true);
    expect(isAnthropicModel("openai/gpt-5.4-mini")).toBe(false);
  });

  it("detects via model object provider", () => {
    expect(isAnthropicModel(fakeAnthropicModel())).toBe(true);
    expect(isAnthropicModel(fakeOpenAIModel())).toBe(false);
  });

  it("matches modelId substring when provider is e.g. gateway", () => {
    const gatewayClaude = {
      provider: "gateway",
      modelId: "anthropic/claude-3-5-sonnet",
    } as unknown as LanguageModel;
    expect(isAnthropicModel(gatewayClaude)).toBe(true);
  });
});

describe("addCacheControl — tools", () => {
  const sampleTools: ToolSet = {
    one: tool({ description: "one", inputSchema: z.object({}), execute: async () => "x" }),
    two: tool({ description: "two", inputSchema: z.object({}), execute: async () => "y" }),
    three: tool({ description: "three", inputSchema: z.object({}), execute: async () => "z" }),
  };

  it("marks only the last tool with ephemeral cache control for Anthropic", () => {
    const out = addCacheControl({ tools: sampleTools, model: fakeAnthropicModel() });
    const entries = Object.entries(out);
    for (const [name, entry] of entries.slice(0, -1)) {
      expect(
        (entry as unknown as { providerOptions?: unknown }).providerOptions,
        name,
      ).toBeUndefined();
    }
    const last = entries.at(-1)![1] as unknown as {
      providerOptions: { anthropic: { cacheControl: { type: string } } };
    };
    expect(last.providerOptions.anthropic.cacheControl.type).toBe("ephemeral");
  });

  it("returns tools unchanged for non-Anthropic models", () => {
    const out = addCacheControl({ tools: sampleTools, model: fakeOpenAIModel() });
    expect(out).toBe(sampleTools);
  });

  it("handles an empty tool set", () => {
    const empty: ToolSet = {};
    expect(addCacheControl({ tools: empty, model: fakeAnthropicModel() })).toBe(empty);
  });
});

describe("addCacheControl — messages", () => {
  const msgs: ModelMessage[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "user", content: "last" },
  ];

  it("marks only the final message for Anthropic", () => {
    const out = addCacheControl({ messages: msgs, model: fakeAnthropicModel() });
    expect(out[0]!.providerOptions).toBeUndefined();
    expect(out[1]!.providerOptions).toBeUndefined();
    expect(
      (
        out.at(-1)! as unknown as {
          providerOptions: { anthropic: { cacheControl: { type: string } } };
        }
      ).providerOptions.anthropic.cacheControl.type,
    ).toBe("ephemeral");
  });

  it("returns messages unchanged for non-Anthropic models", () => {
    const out = addCacheControl({ messages: msgs, model: fakeOpenAIModel() });
    expect(out).toBe(msgs);
  });

  it("handles an empty message list", () => {
    const empty: ModelMessage[] = [];
    expect(addCacheControl({ messages: empty, model: fakeAnthropicModel() })).toBe(empty);
  });
});

describe("addCacheControl — guards", () => {
  it("throws when neither tools nor messages supplied", () => {
    expect(() =>
      (addCacheControl as (opts: { model: LanguageModel }) => unknown)({
        model: fakeAnthropicModel(),
      }),
    ).toThrow(/tools or messages/);
  });

  it("accepts a caller-supplied providerOptions override (different provider key)", () => {
    const out = addCacheControl({
      tools: {
        only: tool({ description: "", inputSchema: z.object({}), execute: async () => "" }),
      },
      model: fakeAnthropicModel(),
      providerOptions: { custom: { marker: true } },
    });
    const only = out.only as unknown as { providerOptions: { custom: { marker: boolean } } };
    expect(only.providerOptions.custom.marker).toBe(true);
  });
});
