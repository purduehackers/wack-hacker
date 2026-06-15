import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  discordRESTClass,
  linearClientClass,
  notionClientClass,
  octokitClass,
  resendClass,
} from "@/lib/test/fixtures";

// Neutralize third-party SDK clients so the orchestrator tool chain (pulled in
// transitively via streamTurn → delegates) imports cleanly without real creds.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const { __setDiscordRestForSimulation } = await import("@/lib/ai/tools/discord/client");
const { __setRedisForSimulation } = await import("@/lib/redis/client");
const { SIM_BOT_ID } = await import("./constants.ts");
const { getOrCreateSession, resetSessions } = await import("./run-registry.ts");

const PING = `<@${SIM_BOT_ID}>`;

beforeAll(() => {
  process.env.SIMULATOR_ENABLED = "1";
});

afterEach(() => {
  resetSessions();
  __setRedisForSimulation(null);
  __setDiscordRestForSimulation(null);
});

// These cover the gating that short-circuits BEFORE the model runs (empty
// mention, no-ping), so they need no provider creds. The streaming reply and
// approval lifecycle are exercised against the real orchestrator (the tracing
// wrapper is unit-tested in trace-orchestrator.test.ts; the full approval flow
// by the live integration path).
describe("SimConversation.runTurn", () => {
  it("replies to an empty mention without streaming", async () => {
    const session = getOrCreateSession("s2");
    await session.runTurn({ sessionId: "s2", content: PING, role: "public" });
    const botMsg = session.bus
      .history()
      .find((e) => e.type === "message.create" && e.message.authorKind === "bot");
    expect(botMsg?.type === "message.create" && botMsg.message.content).toBe(
      "Hey! What can I help you with?",
    );
  });

  it("stays silent when the bot is not pinged in a channel", async () => {
    const session = getOrCreateSession("s2b");
    await session.runTurn({
      sessionId: "s2b",
      content: "just chatting with the room",
      role: "public",
    });
    const history = session.bus.history();
    // The user's message posts, but the bot never replies or opens a thread.
    expect(
      history.some((e) => e.type === "message.create" && e.message.authorKind === "user"),
    ).toBe(true);
    expect(history.some((e) => e.type === "message.create" && e.message.authorKind === "bot")).toBe(
      false,
    );
    expect(history.some((e) => e.type === "channel.create")).toBe(false);
    expect(history.some((e) => e.type === "run.start")).toBe(false);
  });
});
