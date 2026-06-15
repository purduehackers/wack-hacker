import { afterEach, describe, expect, it } from "vitest";

import { wrapToolWithApproval } from "@/lib/ai/approvals/runtime";
import { ApprovalStore } from "@/lib/ai/approvals/store";
import { __setDiscordRestForSimulation } from "@/lib/ai/tools/discord/client";
import { contextForRole, noopTool } from "@/lib/test/fixtures/ai";
import { createMemoryRedis } from "@/lib/test/fixtures/redis";

import type { SimEvent } from "./types.ts";

import { SIM_REVIEWER_ID } from "./constants.ts";
import { SimEventBus } from "./event-bus.ts";
import { createFakeRest } from "./fake-rest.ts";
import { VirtualGuild } from "./virtual-guild.ts";

type ApprovalExecute = (input: unknown, runtime: unknown) => AsyncGenerator<unknown>;

function setup() {
  const guild = new VirtualGuild({ guildId: "g1", botUserId: "bot1" });
  const bus = new SimEventBus("run1");
  __setDiscordRestForSimulation(createFakeRest(guild, bus));
  const store = new ApprovalStore(createMemoryRedis());
  return { guild, bus, store };
}

async function waitForEvent<T extends SimEvent["type"]>(
  bus: SimEventBus,
  type: T,
): Promise<Extract<SimEvent, { type: T }>> {
  for (let i = 0; i < 100; i++) {
    const found = bus.history().find((e) => e.type === type);
    if (found) return found as Extract<SimEvent, { type: T }>;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`event ${type} never arrived`);
}

afterEach(() => __setDiscordRestForSimulation(null));

describe("createFakeRest + approval runtime", () => {
  it("posts an approval prompt and runs the tool once approved", async () => {
    const { bus, store } = setup();
    const wrapped = wrapToolWithApproval(
      noopTool("do_thing"),
      "do_thing",
      { risk: "write", confirmMode: "self" },
      { context: contextForRole("organizer"), store, timeoutMs: 5000 },
    );

    const collected: unknown[] = [];
    const pump = (async () => {
      for await (const value of (wrapped.execute as ApprovalExecute)({ _reason: "need it" }, {})) {
        collected.push(value);
      }
    })();

    const prompt = await waitForEvent(bus, "approval.prompt");
    expect(prompt.toolName).toBe("do_thing");
    expect(prompt.embed.color).toBe(0xffaa00);

    const created = bus.history().find((e) => e.type === "message.create");
    expect(created?.type === "message.create" && created.message.approvalId).toBe(
      prompt.approvalId,
    );

    await store.decide(prompt.approvalId, "approved", SIM_REVIEWER_ID);
    await pump;

    expect(collected).toContain("do_thing");
  });

  it("converges to a denied decision and does not run the tool", async () => {
    const { bus, store } = setup();
    const wrapped = wrapToolWithApproval(
      noopTool("dangerous"),
      "dangerous",
      { risk: "destructive", confirmMode: "second-party" },
      { context: contextForRole("organizer"), store, timeoutMs: 5000 },
    );

    const collected: unknown[] = [];
    const pump = (async () => {
      for await (const value of (wrapped.execute as ApprovalExecute)({ _reason: "no" }, {})) {
        collected.push(value);
      }
    })();

    const prompt = await waitForEvent(bus, "approval.prompt");
    await store.decide(prompt.approvalId, "denied", SIM_REVIEWER_ID);

    const decision = await waitForEvent(bus, "approval.decision");
    expect(decision.status).toBe("denied");
    expect(decision.decidedByUserId).toBe(SIM_REVIEWER_ID);

    await pump;
    expect(collected).not.toContain("dangerous");
    expect(collected.some((v) => typeof v === "string" && v.includes("denied"))).toBe(true);
  });
});
