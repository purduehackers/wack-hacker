import { tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentContext } from "@/lib/ai/context";
import { createMemoryRedis, messagePacket } from "@/lib/test/fixtures";

import { approval } from "./index.ts";
import { wrapApprovalTools } from "./runtime.ts";
import { ApprovalStore } from "./store.ts";

// Mock the third-party Discord REST client at the module level so the wrapper
// exercises its real `discord.post(...)` path without hitting the network.
const { restPost } = vi.hoisted(() => ({
  restPost: vi.fn<(route: string, opts: { body: unknown }) => Promise<unknown>>(),
}));
vi.mock("@discordjs/rest", () => ({
  REST: class {
    setToken() {
      return this;
    }
    post = restPost;
  },
}));

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

function extractApprovalId(callIdx = 0): string {
  const [, opts] = restPost.mock.calls[callIdx]!;
  const body = opts.body as { components: [{ components: [{ custom_id: string }] }] };
  return body.components[0].components[0].custom_id.split(":")[2]!;
}

beforeEach(() => {
  restPost.mockReset();
  restPost.mockResolvedValue({ id: "msg-1" });
});

afterEach(() => {
  restPost.mockReset();
});

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

  it("wraps tools whose inputSchema is not a ZodObject without extending it", () => {
    const nonObjectSchema = z.union([z.string(), z.number()]);
    const gated = approval(
      tool({
        description: "raw",
        inputSchema: nonObjectSchema,
        execute: async () => "ok",
      }),
    );
    const out = wrapApprovalTools({ t: gated }, { context });
    expect(out.t.inputSchema).toBe(nonObjectSchema);
  });
});

describe("wrapApprovalTools — decisions", () => {
  it("runs the original tool when the approval is marked approved", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const out = wrapApprovalTools({ make: gatedTool() }, { context, store, timeoutMs: 10_000 });

    const { values, drain } = startExec(out.make, { name: "widget", _reason: "needed" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);

    await drain;
    expect(values.at(-1)).toBe("created widget");
  });

  it("returns a denial string when the approval is denied", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const out = wrapApprovalTools({ make: gatedTool() }, { context, store, timeoutMs: 10_000 });
    const { values, drain } = startExec(out.make, { name: "widget", _reason: "maybe" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId();
    await store.decide(id, "denied", context.userId);

    await drain;
    expect(values.at(-1)).toMatch(/denied permission/);
  });

  it("returns a timeout string when the approval polling deadline passes", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const out = wrapApprovalTools({ make: gatedTool() }, { context, store, timeoutMs: 50 });
    const { values, drain } = startExec(out.make, { name: "widget", _reason: "tick" });
    await drain;
    expect(values.at(-1)).toMatch(/timed out/i);
  });
});

describe("wrapApprovalTools — streaming", () => {
  it("forwards every value yielded by a streaming original tool", async () => {
    const store = new ApprovalStore(createMemoryRedis());
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

    const out = wrapApprovalTools({ s: streamingTool }, { context, store, timeoutMs: 10_000 });
    const { values, drain } = startExec(out.s, { _reason: "stream" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);

    await drain;
    expect(values).toEqual(["a", "b", "c"]);
  });
});

describe("wrapApprovalTools — Discord integration", () => {
  it("posts to the channel via the real REST client path", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const out = wrapApprovalTools({ t: gatedTool() }, { context, store, timeoutMs: 10_000 });
    const { drain } = startExec(out.t, { name: "x", _reason: "r" });

    await new Promise((r) => setTimeout(r, 20));
    expect(restPost).toHaveBeenCalledTimes(1);
    const [route, opts] = restPost.mock.calls[0]!;
    expect(route).toContain(context.channel.id);
    const body = opts.body as { content: string; allowed_mentions: { users: string[] } };
    expect(body.content).toBe(`<@${context.userId}>`);
    expect(body.allowed_mentions.users).toEqual([context.userId]);

    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);
    await drain;
  });

  it("posts into the thread when the context has one", async () => {
    const threadedContext = AgentContext.fromPacket(
      messagePacket("hi", { thread: { parentId: "parent-1", parentName: "general" } }),
    );
    const store = new ApprovalStore(createMemoryRedis());
    const out = wrapApprovalTools(
      { t: gatedTool() },
      { context: threadedContext, store, timeoutMs: 10_000 },
    );
    const { drain } = startExec(out.t, { name: "x", _reason: "r" });

    await new Promise((r) => setTimeout(r, 20));
    const [route] = restPost.mock.calls[0]!;
    expect(route).toContain(threadedContext.thread!.id);

    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);
    await drain;
  });

  it("surfaces a post failure without running the original tool", async () => {
    restPost.mockRejectedValueOnce(new Error("network down"));
    const store = new ApprovalStore(createMemoryRedis());
    const innerExec = vi.fn(async () => "should-not-run");
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({ x: z.string() }),
        execute: innerExec,
      }),
    );

    const out = wrapApprovalTools({ t: gated }, { context, store });
    const { values, drain } = startExec(out.t, { x: "a", _reason: "r" });
    await drain;

    expect(values.at(-1)).toMatch(/failed to send/i);
    expect(innerExec).not.toHaveBeenCalled();
  });
});

describe("wrapApprovalTools — reason handling", () => {
  it("strips _reason from the input before invoking the original execute", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const innerExec = vi.fn(async (input: { x: string }) => `got ${input.x}`);
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({ x: z.string() }),
        execute: innerExec,
      }),
    );

    const out = wrapApprovalTools({ t: gated }, { context, store, timeoutMs: 10_000 });
    const { drain } = startExec(out.t, { x: "hello", _reason: "because" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);

    await drain;

    const [innerInput] = innerExec.mock.calls[0]!;
    expect(innerInput).toEqual({ x: "hello" });
  });

  it("uses the static reason when the agent omits _reason", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({}),
        execute: async () => "ok",
      }),
      { reason: "static fallback" },
    );

    const out = wrapApprovalTools({ t: gated }, { context, store, timeoutMs: 10_000 });
    const { drain } = startExec(out.t, {});

    await new Promise((r) => setTimeout(r, 20));
    const [, opts] = restPost.mock.calls[0]!;
    const body = opts.body as { embeds: { fields: { name: string; value: string }[] }[] };
    const reasonField = body.embeds[0].fields.find((f) => f.name === "Reason");
    expect(reasonField?.value).toBe("static fallback");

    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);
    await drain;
  });

  it("prefers the agent-supplied _reason over the static reason", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const gated = approval(
      tool({
        description: "t",
        inputSchema: z.object({}),
        execute: async () => "ok",
      }),
      { reason: "static fallback" },
    );

    const out = wrapApprovalTools({ t: gated }, { context, store, timeoutMs: 10_000 });
    const { drain } = startExec(out.t, { _reason: "dynamic override" });

    await new Promise((r) => setTimeout(r, 20));
    const [, opts] = restPost.mock.calls[0]!;
    const body = opts.body as { embeds: { fields: { name: string; value: string }[] }[] };
    const reasonField = body.embeds[0].fields.find((f) => f.name === "Reason");
    expect(reasonField?.value).toBe("dynamic override");

    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);
    await drain;
  });

  it("falls back to '(not provided)' when neither _reason nor staticReason is set", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const out = wrapApprovalTools({ t: gatedTool() }, { context, store, timeoutMs: 10_000 });
    // Bypass Zod by calling execute directly with no _reason — the wrapper
    // should still resolve a reason string for the embed.
    const { drain } = startExec(out.t, { name: "x" });

    await new Promise((r) => setTimeout(r, 20));
    const [, opts] = restPost.mock.calls[0]!;
    const body = opts.body as { embeds: { fields: { name: string; value: string }[] }[] };
    const reasonField = body.embeds[0].fields.find((f) => f.name === "Reason");
    expect(reasonField?.value).toBe("(not provided)");

    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);
    await drain;
  });
});

describe("wrapApprovalTools — no execute", () => {
  it("yields a 'nothing ran' string when the marked tool has no execute", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    // Build a raw tool-shaped object without an execute function, then mark it.
    const bare = approval({
      description: "no exec",
      inputSchema: z.object({}),
    } as unknown as ReturnType<typeof gatedTool>);

    const out = wrapApprovalTools({ t: bare }, { context, store, timeoutMs: 10_000 });
    const { values, drain } = startExec(out.t, { _reason: "r" });

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);
    await drain;

    expect(values.at(-1)).toMatch(/nothing ran/);
  });
});

describe("wrapApprovalTools — TTL", () => {
  it("derives TTL from timeoutMs + a 60s buffer", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const createSpy = vi.spyOn(store, "create");

    const out = wrapApprovalTools({ t: gatedTool() }, { context, store, timeoutMs: 120_000 });
    const { drain } = startExec(out.t, { name: "x", _reason: "r" });

    await new Promise((r) => setTimeout(r, 20));
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [, ttlArg] = createSpy.mock.calls[0]!;
    expect(ttlArg).toBe(180); // 120s + 60s buffer

    const id = extractApprovalId();
    await store.decide(id, "approved", context.userId);
    await drain;
  });
});
