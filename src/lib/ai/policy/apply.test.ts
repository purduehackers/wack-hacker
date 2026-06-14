import { tool, type Tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DISCORD_IDS } from "@/lib/protocol/constants";
import { messagePacket } from "@/lib/test/fixtures";

import type { ApprovalState, ApprovalStoreLike } from "../approvals/types.ts";
import type { ActionAuditEntry, AuditLogLike } from "./types.ts";

// Mock the third-party Discord REST client at the module level so the
// approval wrapper exercises its real post/patch paths without the network.
const { restPost, restPatch } = vi.hoisted(() => ({
  restPost: vi.fn<(route: string, opts: { body: unknown }) => Promise<unknown>>(async () => ({
    id: "msg-1",
  })),
  restPatch: vi.fn<(route: string, opts: { body: unknown }) => Promise<unknown>>(async () => ({})),
}));
vi.mock("@discordjs/rest", () => ({
  REST: class {
    setToken() {
      return this;
    }
    post = restPost;
    patch = restPatch;
  },
}));

const { AgentContext } = await import("../context.ts");
const { approval } = await import("../approvals/index.ts");
const { BUDGET_DENY_MESSAGE } = await import("./constants.ts");
const { access } = await import("./access.ts");
const { applyPolicy } = await import("./apply.ts");

function contextFor(role: "public" | "organizer" | "admin") {
  const memberRoles =
    role === "public"
      ? undefined
      : role === "organizer"
        ? [DISCORD_IDS.roles.ORGANIZER]
        : [DISCORD_IDS.roles.ADMIN];
  return AgentContext.fromPacket(messagePacket("hello", { memberRoles }));
}

function makeTool(executeSpy = vi.fn(async ({ name }: { name: string }) => `did ${name}`)) {
  return {
    spy: executeSpy,
    tool: tool({
      description: "Do a thing",
      inputSchema: z.object({ name: z.string() }),
      execute: executeSpy,
    }),
  };
}

/** Fake store whose decision is preconfigured; captures the created state. */
function fakeStore(finalStatus: "approved" | "denied" | "timeout", decidedBy?: string) {
  const created: ApprovalState[] = [];
  const store: ApprovalStoreLike = {
    create: async (state) => {
      created.push(state);
    },
    get: async () => created[0] ?? null,
    setMessageId: async () => {},
    decide: async () => null,
    waitFor: async () => ({
      ...created[0]!,
      status: finalStatus,
      decidedByUserId: decidedBy,
    }),
  };
  return { store, created };
}

function fakeAudit() {
  const entries: ActionAuditEntry[] = [];
  const audit: AuditLogLike = {
    record: async (entry) => {
      entries.push(entry);
    },
  };
  return { audit, entries };
}

type ExecuteFn = (input: unknown, opts: unknown) => unknown;

async function drain(t: Tool, input: Record<string, unknown>): Promise<unknown[]> {
  const result = (t.execute as ExecuteFn)(input, {
    abortSignal: new AbortController().signal,
  });
  const values: unknown[] = [];
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    for await (const v of result as AsyncIterable<unknown>) values.push(v);
    return values;
  }
  values.push(await (result as Promise<unknown>));
  return values;
}

describe("applyPolicy — visibility (deny-by-absence)", () => {
  it("omits tools above the subject's role instead of stubbing them", () => {
    const { tool: t } = makeTool();
    const tools = { gated: access({ risk: "write" }, t) };
    const { audit } = fakeAudit();

    expect(Object.keys(applyPolicy(tools, { context: contextFor("public"), audit }))).toEqual([]);
    expect(Object.keys(applyPolicy(tools, { context: contextFor("organizer"), audit }))).toEqual([
      "gated",
    ]);
  });

  it("honors a minRole override above the risk default", () => {
    const { tool: t } = makeTool();
    const tools = { adminOnly: access({ risk: "read", minRole: "admin" }, t) };
    const { audit } = fakeAudit();

    expect(Object.keys(applyPolicy(tools, { context: contextFor("organizer"), audit }))).toEqual(
      [],
    );
    expect(Object.keys(applyPolicy(tools, { context: contextFor("admin"), audit }))).toEqual([
      "adminOnly",
    ]);
  });
});

describe("applyPolicy — budget denial", () => {
  it("keeps the tool visible but replaces execute with the friendly message", async () => {
    const { tool: t, spy } = makeTool();
    const tools = { reader: access({ risk: "read" }, t) };
    const { audit } = fakeAudit();
    const wrapped = applyPolicy(tools, {
      context: contextFor("public"),
      budget: { used: 999_999, limit: 250_000 },
      audit,
    });

    expect(Object.keys(wrapped)).toEqual(["reader"]);
    const out = await drain(wrapped.reader!, { name: "x" });
    expect(out).toEqual([BUDGET_DENY_MESSAGE]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("leaves budget-exempt roles untouched", async () => {
    const { tool: t } = makeTool();
    const tools = { reader: access({ risk: "read" }, t) };
    const { audit } = fakeAudit();
    const wrapped = applyPolicy(tools, {
      context: contextFor("organizer"),
      budget: { used: 999_999, limit: 250_000 },
      audit,
    });
    expect(wrapped.reader).toBe(tools.reader);
  });
});

describe("applyPolicy — pass-through", () => {
  it("returns allow-path tools by reference (read/write, no confirm)", () => {
    const read = access({ risk: "read" }, makeTool().tool);
    const write = access({ risk: "write" }, makeTool().tool);
    const unmarked = makeTool().tool;
    const { audit } = fakeAudit();
    const wrapped = applyPolicy(
      { read, write, unmarked },
      { context: contextFor("organizer"), audit },
    );

    expect(wrapped.read).toBe(read);
    expect(wrapped.write).toBe(write);
    expect(wrapped.unmarked).toBe(unmarked);
  });
});

describe("applyPolicy — confirmation wrapping", () => {
  it("wraps destructive tools with the approval flow (self mode by default)", () => {
    const { tool: t } = makeTool();
    const tools = { nuke: access({ risk: "destructive" }, t) };
    const { audit } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), audit });

    expect(wrapped.nuke).not.toBe(tools.nuke);
    expect(wrapped.nuke!.description).toContain("[approval]");
  });

  it("wraps legacy approval()-marked tools the same way", () => {
    const { tool: t } = makeTool();
    const tools = { legacy: approval(t) };
    const { audit } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), audit });
    expect(wrapped.legacy!.description).toContain("[approval]");
  });

  it("approved round-trip: stores second-party mode, runs the tool, audits the lifecycle", async () => {
    const { tool: t, spy } = makeTool();
    const tools = { nuke: access({ risk: "destructive", confirm: "second-party" }, t) };
    const { store, created } = fakeStore("approved", "other-user");
    const { audit, entries } = fakeAudit();
    const ctx = contextFor("organizer");
    const wrapped = applyPolicy(tools, { context: ctx, store, audit });

    const out = await drain(wrapped.nuke!, { name: "x", _reason: "because" });

    expect(created[0]!.confirmMode).toBe("second-party");
    expect(created[0]!.requesterUserId).toBe(ctx.userId);
    expect(spy).toHaveBeenCalledWith({ name: "x" }, expect.anything());
    expect(out.at(-1)).toBe("did x");
    expect(entries.map((e) => e.decision)).toEqual(["requested", "approved", "executed"]);
    expect(entries[1]!.decidedBy).toBe("other-user");
    expect(entries.every((e) => e.tool === "nuke" && e.risk === "destructive")).toBe(true);
  });

  it("denied round-trip: tool never runs, denial audited", async () => {
    const { tool: t, spy } = makeTool();
    const tools = { nuke: access({ risk: "destructive" }, t) };
    const { store } = fakeStore("denied", "u-1");
    const { audit, entries } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), store, audit });

    const out = await drain(wrapped.nuke!, { name: "x", _reason: "because" });

    expect(spy).not.toHaveBeenCalled();
    expect(String(out.at(-1))).toContain("denied permission");
    expect(entries.map((e) => e.decision)).toEqual(["requested", "denied"]);
  });

  it("timeout round-trip: audited as timeout", async () => {
    const { tool: t, spy } = makeTool();
    const tools = { nuke: access({ risk: "destructive" }, t) };
    const { store } = fakeStore("timeout");
    const { audit, entries } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), store, audit });

    const out = await drain(wrapped.nuke!, { name: "x", _reason: "because" });

    expect(spy).not.toHaveBeenCalled();
    expect(String(out.at(-1))).toContain("timed out");
    expect(entries.map((e) => e.decision)).toEqual(["requested", "timeout"]);
  });
});

describe("applyPolicy — confirmation wrapping, prompt send failure", () => {
  it("records a terminal 'prompt_failed' row and never runs the tool when the Discord prompt can't send", async () => {
    const { tool: t, spy } = makeTool();
    const tools = { nuke: access({ risk: "destructive" }, t) };
    const { store } = fakeStore("approved", "user-1");
    const { audit, entries } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), store, audit });

    restPost.mockRejectedValueOnce(new Error("discord 500"));
    const out = await drain(wrapped.nuke!, { name: "x", _reason: "because" });

    expect(spy).not.toHaveBeenCalled();
    expect(String(out.at(-1))).toContain("NOT run");
    // Distinct from execution "failed": the prompt couldn't be delivered.
    expect(entries.map((e) => e.decision)).toEqual(["requested", "prompt_failed"]);
  });
});

describe("applyPolicy — confirmation wrapping, approved execution failure", () => {
  it("audits 'failed' and rethrows when the approved tool throws", async () => {
    const spy = vi.fn(async (): Promise<string> => {
      throw new Error("kaboom");
    });
    const t = tool({ description: "Explodes", inputSchema: z.object({}), execute: spy });
    const tools = { nuke: access({ risk: "destructive" }, t) };
    const { store } = fakeStore("approved", "user-1");
    const { audit, entries } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), store, audit });

    await expect(drain(wrapped.nuke!, { _reason: "because" })).rejects.toThrow("kaboom");
    expect(entries.map((e) => e.decision)).toEqual(["requested", "approved", "failed"]);
  });
});

describe("applyPolicy — destructive allow path (confirm: 'none')", () => {
  it("executes without a prompt but audits the execution", async () => {
    const { tool: t, spy } = makeTool();
    const tools = { fast: access({ risk: "destructive", confirm: "none" }, t) };
    const { audit, entries } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), audit });

    expect(wrapped.fast).not.toBe(tools.fast);
    const out = await drain(wrapped.fast!, { name: "x" });

    expect(spy).toHaveBeenCalledOnce();
    expect(out.at(-1)).toBe("did x");
    expect(entries.map((e) => e.decision)).toEqual(["executed"]);
    expect(entries[0]!.source).toBe("chat");
  });

  it("streams async-generator executes through the audit wrapper", async () => {
    const t = tool({
      description: "Streams",
      inputSchema: z.object({}),
      execute: async function* () {
        yield "first";
        yield "final";
      },
    });
    const tools = { streamer: access({ risk: "destructive", confirm: "none" }, t) };
    const { audit, entries } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), audit });

    const out = await drain(wrapped.streamer!, {});
    expect(out).toEqual(["first", "final"]);
    expect(entries.map((e) => e.decision)).toEqual(["executed"]);
  });

  it("audits failures and rethrows", async () => {
    const spy = vi.fn(async (): Promise<string> => {
      throw new Error("boom");
    });
    const t = tool({
      description: "Explodes",
      inputSchema: z.object({}),
      execute: spy,
    });
    const tools = { bomb: access({ risk: "destructive", confirm: "none" }, t) };
    const { audit, entries } = fakeAudit();
    const wrapped = applyPolicy(tools, { context: contextFor("organizer"), audit });

    await expect(drain(wrapped.bomb!, {})).rejects.toThrow("boom");
    expect(entries.map((e) => e.decision)).toEqual(["failed"]);
  });
});
