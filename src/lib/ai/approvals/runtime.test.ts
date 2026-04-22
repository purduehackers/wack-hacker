import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentContext } from "@/lib/ai/context";
import { createMemoryRedis, messagePacket } from "@/lib/test/fixtures";

import { approval } from "./index.ts";
import { wrapApprovalTools } from "./runtime.ts";
import { ApprovalStore } from "./store.ts";

const context = AgentContext.fromPacket(messagePacket("hello"));

function gatedTool() {
  return approval(
    tool({
      description: "Create a thing",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }: { name: string }) => `created ${name}`,
    }),
  );
}

type PostMessageMock = ReturnType<
  typeof vi.fn<(channelId: string, body: unknown) => Promise<{ id: string }>>
>;

function extractApprovalId(postMessage: PostMessageMock, callIdx = 0): string {
  const [, body] = postMessage.mock.calls[callIdx]!;
  const customId = (body as { components: [{ components: [{ custom_id: string }] }] }).components[0]
    .components[0].custom_id;
  return customId.split(":")[2]!;
}

function runtimeOpts(): Parameters<NonNullable<ReturnType<typeof gatedTool>["execute"]>>[1] {
  return { abortSignal: new AbortController().signal } as Parameters<
    NonNullable<ReturnType<typeof gatedTool>["execute"]>
  >[1];
}

function startExec(t: unknown, input: Record<string, unknown>) {
  const exec = (t as { execute: (input: unknown, opts: unknown) => unknown }).execute;
  const iter = exec(input, runtimeOpts()) as AsyncIterable<unknown>;
  const values: unknown[] = [];
  const drain = (async () => {
    for await (const v of iter) values.push(v);
  })();
  return { values, drain };
}

describe("wrapApprovalTools — shape", () => {
  it("passes through unmarked tools by identity", () => {
    const plain = tool({
      description: "plain",
      inputSchema: z.object({}),
      execute: async () => "ok",
    });
    const out = wrapApprovalTools({ plain }, { context });
    expect(out.plain).toBe(plain);
  });

  it("replaces marked tools with a wrapper whose schema includes _reason", () => {
    const out = wrapApprovalTools({ t: gatedTool() }, { context });
    const schema = out.t.inputSchema as z.ZodObject<z.ZodRawShape>;
    expect(schema.shape._reason).toBeDefined();
    expect(schema.shape.name).toBeDefined();
  });

  it("makes _reason required when no static reason is configured", () => {
    const out = wrapApprovalTools({ t: gatedTool() }, { context });
    const schema = out.t.inputSchema as z.ZodObject<z.ZodRawShape>;
    expect(schema.safeParse({ name: "x" }).success).toBe(false);
    expect(schema.safeParse({ name: "x", _reason: "r" }).success).toBe(true);
  });

  it("makes _reason optional when a static reason is configured", () => {
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({ name: z.string() }),
        execute: async () => "ok",
      }),
      { reason: "default" },
    );
    const out = wrapApprovalTools({ t: gated }, { context });
    const schema = out.t.inputSchema as z.ZodObject<z.ZodRawShape>;
    expect(schema.safeParse({ name: "x" }).success).toBe(true);
    expect(schema.safeParse({ name: "x", _reason: "override" }).success).toBe(true);
  });
});

describe("wrapApprovalTools — decisions", () => {
  it("runs the original tool when the approval is marked approved", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => ({ id: "msg-1" }));

    const out = wrapApprovalTools(
      { make: gatedTool() },
      { context, store, postMessage, timeoutMs: 10_000 },
    );

    const { values, drain } = startExec(out.make, { name: "widget", _reason: "needed" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);

    await drain;
    expect(values.at(-1)).toBe("created widget");
  });

  it("returns a denial string when the approval is denied", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => ({ id: "msg-2" }));

    const out = wrapApprovalTools(
      { make: gatedTool() },
      { context, store, postMessage, timeoutMs: 10_000 },
    );
    const { values, drain } = startExec(out.make, { name: "widget", _reason: "maybe" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId(postMessage);
    await store.decide(id, "denied", context.userId);

    await drain;
    expect(values.at(-1)).toMatch(/denied permission/);
  });

  it("returns a timeout string when the approval polling deadline passes", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => ({ id: "msg-t" }));

    const out = wrapApprovalTools(
      { make: gatedTool() },
      { context, store, postMessage, timeoutMs: 50 },
    );
    const { values, drain } = startExec(out.make, { name: "widget", _reason: "tick" });
    await drain;
    expect(values.at(-1)).toMatch(/timed out/i);
  });
});

describe("wrapApprovalTools — streaming", () => {
  it("forwards every value yielded by a streaming original tool", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => ({ id: "msg-s" }));
    const streamingTool = approval(
      tool({
        description: "streaming",
        inputSchema: z.object({}),
        async *execute() {
          yield "a";
          yield "b";
          yield "c";
        },
      }),
    );

    const out = wrapApprovalTools(
      { s: streamingTool },
      { context, store, postMessage, timeoutMs: 10_000 },
    );
    const { values, drain } = startExec(out.s, { _reason: "stream" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);

    await drain;
    expect(values).toEqual(["a", "b", "c"]);
  });
});

describe("wrapApprovalTools — edge cases", () => {
  it("surfaces a message-send failure without running the original tool", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => {
      throw new Error("network down");
    });
    const innerExec = vi.fn(async () => "should-not-run");
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({ x: z.string() }),
        execute: innerExec,
      }),
    );

    const out = wrapApprovalTools({ t: gated }, { context, store, postMessage });
    const { values, drain } = startExec(out.t, { x: "a", _reason: "r" });
    await drain;

    expect(values.at(-1)).toMatch(/failed to send/i);
    expect(innerExec).not.toHaveBeenCalled();
  });

  it("strips _reason from the input before invoking the original execute", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => ({ id: "m" }));
    const innerExec = vi.fn(async (input: { x: string }) => `got ${input.x}`);
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({ x: z.string() }),
        execute: innerExec,
      }),
    );

    const out = wrapApprovalTools({ t: gated }, { context, store, postMessage, timeoutMs: 10_000 });
    const { drain } = startExec(out.t, { x: "hello", _reason: "because" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);

    await drain;

    const [innerInput] = innerExec.mock.calls[0]!;
    expect(innerInput).toEqual({ x: "hello" });
  });

  it("uses the static reason when the agent omits _reason", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage: PostMessageMock = vi.fn(async () => ({ id: "m" }));
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({}),
        execute: async () => "ok",
      }),
      { reason: "static fallback" },
    );

    const out = wrapApprovalTools({ t: gated }, { context, store, postMessage, timeoutMs: 10_000 });
    const { drain } = startExec(out.t, {});

    await new Promise((r) => setTimeout(r, 20));
    const [, body] = postMessage.mock.calls[0]!;
    const embed = (body as { embeds: { fields: { name: string; value: string }[] }[] }).embeds[0];
    const reasonField = embed.fields.find((f) => f.name === "Reason");
    expect(reasonField?.value).toBe("static fallback");

    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);
    await drain;
  });

  it("prefers the agent-supplied _reason over the static reason", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage: PostMessageMock = vi.fn(async () => ({ id: "m" }));
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({}),
        execute: async () => "ok",
      }),
      { reason: "static fallback" },
    );

    const out = wrapApprovalTools({ t: gated }, { context, store, postMessage, timeoutMs: 10_000 });
    const { drain } = startExec(out.t, { _reason: "dynamic override" });

    await new Promise((r) => setTimeout(r, 20));
    const [, body] = postMessage.mock.calls[0]!;
    const embed = (body as { embeds: { fields: { name: string; value: string }[] }[] }).embeds[0];
    const reasonField = embed.fields.find((f) => f.name === "Reason");
    expect(reasonField?.value).toBe("dynamic override");

    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);
    await drain;
  });

  it("passes a TTL derived from timeoutMs to store.create", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const createSpy = vi.spyOn(store, "create");
    const postMessage = vi.fn(async () => ({ id: "m" }));

    const out = wrapApprovalTools(
      { t: gatedTool() },
      { context, store, postMessage, timeoutMs: 120_000 },
    );
    const { drain } = startExec(out.t, { name: "x", _reason: "r" });

    await new Promise((r) => setTimeout(r, 20));
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [, ttlArg] = createSpy.mock.calls[0]!;
    // 120s timeout + 60s buffer = 180s TTL
    expect(ttlArg).toBe(180);

    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);
    await drain;
  });
});
