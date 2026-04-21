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
});

describe("wrapApprovalTools — decisions", () => {
  it("runs the original tool when the approval is marked approved", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => ({ id: "msg-1" }));

    const out = wrapApprovalTools(
      { make: gatedTool() },
      { context, store, postMessage, timeoutMs: 10_000 },
    );

    const pending = out.make.execute!(
      { name: "widget", _reason: "needed" },
      runtimeOpts(),
    ) as Promise<unknown>;

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);

    expect(await pending).toBe("created widget");
  });

  it("returns a denial string when the approval is denied", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    const postMessage = vi.fn(async () => ({ id: "msg-2" }));

    const out = wrapApprovalTools(
      { make: gatedTool() },
      { context, store, postMessage, timeoutMs: 10_000 },
    );
    const pending = out.make.execute!(
      { name: "widget", _reason: "maybe" },
      runtimeOpts(),
    ) as Promise<unknown>;

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId(postMessage);
    await store.decide(id, "denied", context.userId);

    expect(await pending).toMatch(/denied permission/);
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
    const result = await out.t.execute!({ x: "a", _reason: "r" }, runtimeOpts());

    expect(result).toMatch(/failed to send/i);
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
    const pending = out.t.execute!(
      { x: "hello", _reason: "because" },
      runtimeOpts(),
    ) as Promise<unknown>;

    await new Promise((r) => setTimeout(r, 20));
    const id = extractApprovalId(postMessage);
    await store.decide(id, "approved", context.userId);

    await pending;

    const [innerInput] = innerExec.mock.calls[0]!;
    expect(innerInput).toEqual({ x: "hello" });
  });
});
