import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deletePacket,
  discordRESTClass,
  linearClientClass,
  memoryStore,
  notionClientClass,
  octokitClass,
  resendClass,
} from "@/lib/test/fixtures";

vi.mock("@/lib/metrics", () => ({
  countMetric: vi.fn(),
  recordDuration: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  resumeHook: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue({ runId: "run-1" }),
}));

// Third-party SDK mocks — process-event.ts transitively loads the router and
// its handlers, which instantiate SDK clients on import.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const { countMetric } = await import("@/lib/metrics");
const { PacketCodec } = await import("@/lib/protocol/packets");
const { handleDiscordEvent } = await import("./process-event");

const metadata = { deliveryCount: 1, messageId: "qm-1" };

beforeEach(() => {
  vi.mocked(countMetric).mockClear();
});

describe("handleDiscordEvent — decode guard", () => {
  it("drops undecodable payloads without throwing (acks instead of retrying)", async () => {
    await expect(handleDiscordEvent("not json", metadata, memoryStore())).resolves.toBeUndefined();
    expect(countMetric).toHaveBeenCalledWith("discord.event.decode_failed");
  });

  it("drops packet types removed from the protocol (previous-deploy traffic)", async () => {
    const stale = JSON.stringify({
      type: "GATEWAY_VOICE_STATE_UPDATE",
      timestamp: new Date("2024-01-01"),
      data: { userId: "u1", guildId: "g1", channelId: null, sessionId: "s1" },
    });
    await expect(handleDiscordEvent(stale, metadata, memoryStore())).resolves.toBeUndefined();
    expect(countMetric).toHaveBeenCalledWith("discord.event.decode_failed");
    expect(countMetric).not.toHaveBeenCalledWith("event.processed", expect.anything());
  });
});

describe("handleDiscordEvent — decode→dispatch composition", () => {
  it("decodes a valid packet and processes it through the router", async () => {
    const encoded = PacketCodec.encode(deletePacket());
    await handleDiscordEvent(encoded, metadata, memoryStore());
    expect(countMetric).toHaveBeenCalledWith("discord.event.callback_received", {
      type: "GATEWAY_MESSAGE_DELETE",
    });
    expect(countMetric).toHaveBeenCalledWith("event.processed", {
      type: "GATEWAY_MESSAGE_DELETE",
    });
    expect(countMetric).not.toHaveBeenCalledWith("discord.event.decode_failed");
  });

  it("dedupes a redelivered packet within the same store", async () => {
    const store = memoryStore();
    const encoded = PacketCodec.encode(deletePacket());
    await handleDiscordEvent(encoded, metadata, store);
    await handleDiscordEvent(encoded, { ...metadata, deliveryCount: 2 }, store);
    expect(countMetric).toHaveBeenCalledWith("event.dedup_hit", {
      type: "GATEWAY_MESSAGE_DELETE",
    });
  });
});
