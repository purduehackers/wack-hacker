import { describe, expect, it, vi } from "vitest";

import type { AgentContext } from "@/lib/ai/context";
import type { TurnUsageTracker } from "@/lib/ai/turn-usage";
import type { OrchestratorAgent, OrchestratorFactory } from "@/lib/ai/types";

import {
  discordRESTClass,
  linearClientClass,
  notionClientClass,
  octokitClass,
  resendClass,
} from "@/lib/test/fixtures";

// trace-orchestrator imports createOrchestrator, which transitively instantiates
// third-party SDK clients (octokit/linear/notion/…) at module load. Neutralize
// them so the import chain resolves without real creds (mirrors conversation.test).
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const { SimEventBus } = await import("./event-bus.ts");
const { createTracingOrchestratorFactory } = await import("./trace-orchestrator.ts");

/** A base factory whose agent replays a fixed AI-SDK-shaped fullStream. */
function fakeFactory(parts: unknown[]): OrchestratorFactory {
  return (): OrchestratorAgent => ({
    stream: async () => ({
      fullStream: (async function* () {
        for (const part of parts) yield part;
      })(),
      totalUsage: Promise.resolve({}),
      steps: Promise.resolve([]),
    }),
  });
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

const CTX = null as unknown as AgentContext;
const TRACKER = null as unknown as TurnUsageTracker;

describe("createTracingOrchestratorFactory", () => {
  it("re-emits tool lifecycle parts as trace.tool events, matched by toolCallId", async () => {
    const bus = new SimEventBus("t1");
    const factory = createTracingOrchestratorFactory(
      bus,
      fakeFactory([
        { type: "tool-input-start", toolCallId: "c1", toolName: "web_search" },
        { type: "tool-result", toolCallId: "c1", preliminary: true },
        { type: "tool-result", toolCallId: "c1" },
        { type: "text-delta", id: "t", text: "done" },
      ]),
    );
    const agent = factory(CTX, TRACKER, undefined, "anthropic/claude-sonnet-4.6", null);
    const result = await agent.stream({ messages: [] });
    await drain(result.fullStream);

    const trace = bus.history().filter((e) => e.type === "trace.tool");
    expect(trace).toHaveLength(3);
    expect(trace.every((e) => e.type === "trace.tool" && e.toolCallId === "c1")).toBe(true);
    const start = trace[0];
    expect(start.type === "trace.tool" && start.phase).toBe("start");
    expect(start.type === "trace.tool" && start.toolName).toBe("web_search");
    const prelim = trace[1];
    expect(prelim.type === "trace.tool" && prelim.phase).toBe("result");
    expect(prelim.type === "trace.tool" && prelim.preliminary).toBe(true);
  });

  it("splits delegate_<domain> tool calls into a delegateName for subagent rows", async () => {
    const bus = new SimEventBus("td");
    const factory = createTracingOrchestratorFactory(
      bus,
      fakeFactory([
        { type: "tool-input-start", toolCallId: "d1", toolName: "delegate_github" },
        { type: "tool-input-start", toolCallId: "w1", toolName: "web_search" },
      ]),
    );
    await drain(
      (await factory(CTX, TRACKER, undefined, "model", null).stream({ messages: [] })).fullStream,
    );

    const trace = bus.history().filter((e) => e.type === "trace.tool");
    const delegate = trace.find((e) => e.type === "trace.tool" && e.toolCallId === "d1");
    expect(delegate?.type === "trace.tool" && delegate.delegateName).toBe("github");
    const plain = trace.find((e) => e.type === "trace.tool" && e.toolCallId === "w1");
    expect(plain?.type === "trace.tool" && plain.delegateName).toBeUndefined();
  });

  it("emits an error-phase row for tool-error parts", async () => {
    const bus = new SimEventBus("t2");
    const factory = createTracingOrchestratorFactory(
      bus,
      fakeFactory([
        { type: "tool-input-start", toolCallId: "c9", toolName: "schedule_task" },
        { type: "tool-error", toolCallId: "c9" },
      ]),
    );
    const agent = factory(CTX, TRACKER, undefined, "model", null);
    await drain((await agent.stream({ messages: [] })).fullStream);

    const phases = bus
      .history()
      .filter((e) => e.type === "trace.tool")
      .map((e) => (e.type === "trace.tool" ? e.phase : ""));
    expect(phases).toEqual(["start", "error"]);
  });

  it("passes every stream part through unchanged (renderer still drives the UX)", async () => {
    const bus = new SimEventBus("t3");
    const parts = [
      { type: "tool-input-start", toolCallId: "c1", toolName: "web_search" },
      { type: "tool-result", toolCallId: "c1" },
      { type: "text-delta", id: "t", text: "hi" },
    ];
    const factory = createTracingOrchestratorFactory(bus, fakeFactory(parts));
    const agent = factory(CTX, TRACKER, undefined, "model", null);
    const seen = await drain((await agent.stream({ messages: [] })).fullStream);
    expect(seen).toEqual(parts);
  });
});
