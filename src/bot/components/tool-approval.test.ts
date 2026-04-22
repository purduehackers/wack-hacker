import type { API } from "@discordjs/core/http-only";

import { describe, expect, it, vi } from "vitest";

import { ApprovalStore } from "@/lib/ai/approvals";
import {
  asAPI,
  baseApprovalState,
  buttonInteraction,
  createMemoryRedis,
  createMockAPI,
} from "@/lib/test/fixtures";

// Mock the third-party Redis client so the `new ApprovalStore()` fallback
// inside the handler has a safe in-memory backend when no store is injected.
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => createMemoryRedis() },
}));

import { buildToolApprovalHandler, toolApproval } from "./tool-approval";

function setup() {
  const store = new ApprovalStore(createMemoryRedis());
  const handler = buildToolApprovalHandler(store);
  const mockAPI = createMockAPI();
  return { store, handler, discord: asAPI(mockAPI) as API, mockAPI };
}

describe("toolApproval — exports", () => {
  it("exports a default handler bound to the `tool-approval` prefix", () => {
    expect(toolApproval.prefix).toBe("tool-approval");
  });
});

describe("toolApproval — happy path", () => {
  it("edits the message and flips status when the requester clicks approve", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    const edits = mockAPI.callsTo("channels.editMessage");
    expect(edits).toHaveLength(1);
    expect(edits[0]![1]).toBe("msg-5");
    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
    expect(after?.decidedByUserId).toBe("user-1");
  });

  it("writes a 'denied' decision when the requester clicks deny", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());

    await handler.handle({
      interaction: buttonInteraction("tool-approval:deny:a1", "user-1"),
      discord,
      customId: "tool-approval:deny:a1",
    });

    expect(mockAPI.callsTo("channels.editMessage")).toHaveLength(1);
    const after = await store.get("a1");
    expect(after?.status).toBe("denied");
  });
});

describe("toolApproval — authorization", () => {
  it("sends an ephemeral follow-up and leaves state pending when a non-requester clicks", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:a1", "impostor"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(mockAPI.callsTo("channels.editMessage")).toHaveLength(0);
    const follows = mockAPI.callsTo("interactions.followUp");
    expect(follows).toHaveLength(1);
    expect((follows[0]![2] as { content: string }).content).toMatch(/Only <@user-1>/);
    const after = await store.get("a1");
    expect(after?.status).toBe("pending");
  });
});

describe("toolApproval — already decided / expired", () => {
  it("converges the channel message and sends an ephemeral reply when already decided", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState({ status: "approved", decidedByUserId: "user-1" }));

    await handler.handle({
      interaction: buttonInteraction("tool-approval:deny:a1", "user-1"),
      discord,
      customId: "tool-approval:deny:a1",
    });

    // Belt-and-suspenders: even on a late click, the message is patched to
    // reflect the stored decision so the UI converges to truth.
    expect(mockAPI.callsTo("channels.editMessage")).toHaveLength(1);
    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/already been approved/);
  });

  it("converges without a decidedByUserId field when the stored status is timeout", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState({ status: "timeout" }));

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(mockAPI.callsTo("channels.editMessage")).toHaveLength(1);
    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/already been timeout/);
  });

  it("sends an ephemeral reply when the approval has expired (missing row)", async () => {
    const { handler, discord, mockAPI } = setup();

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:missing", "user-1"),
      discord,
      customId: "tool-approval:approve:missing",
    });

    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/expired/);
  });
});

describe("toolApproval — customId parsing", () => {
  it("ignores malformed custom ids", async () => {
    const { handler, discord, mockAPI } = setup();

    await handler.handle({
      interaction: buttonInteraction("tool-approval::a1", "user-1"),
      discord,
      customId: "tool-approval::a1",
    });

    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/Malformed/);
  });

  it("ignores custom ids with unknown actions", async () => {
    const { handler, discord, mockAPI } = setup();

    await handler.handle({
      interaction: buttonInteraction("tool-approval:shrug:a1", "user-1"),
      discord,
      customId: "tool-approval:shrug:a1",
    });

    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/Malformed/);
  });

  it("rejects custom ids with no approval id part", async () => {
    const { handler, discord, mockAPI } = setup();

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve", "user-1"),
      discord,
      customId: "tool-approval:approve",
    });

    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/Malformed/);
  });
});

describe("toolApproval — message + context", () => {
  it("skips the message edit when no messageId was stored", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState({ messageId: undefined }));

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(mockAPI.callsTo("channels.editMessage")).toHaveLength(0);
    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
  });

  it("posts to the thread when the approval state carries a threadId", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(
      baseApprovalState({ channelId: "ch-1", threadId: "thread-9", messageId: "msg-5" }),
    );

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    const edits = mockAPI.callsTo("channels.editMessage");
    expect(edits[0]![0]).toBe("thread-9");
  });

  it("rejects clicks from anonymous sources (no member, no user)", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());
    const interaction = buttonInteraction("tool-approval:approve:a1", "user-1");
    delete interaction.member;
    delete interaction.user;

    await handler.handle({
      interaction,
      discord,
      customId: "tool-approval:approve:a1",
    });

    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/identify/i);
    const after = await store.get("a1");
    expect(after?.status).toBe("pending");
  });

  it("resolves the clicker id via interaction.user when there is no member (DM context)", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());
    const interaction = buttonInteraction("tool-approval:approve:a1", "user-1");
    delete interaction.member;
    interaction.user = { id: "user-1", username: "alice" };

    await handler.handle({
      interaction,
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(mockAPI.callsTo("channels.editMessage")).toHaveLength(1);
    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
  });
});

describe("toolApproval — Discord error paths", () => {
  it("swallows an editMessage failure so the decision still persists", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());
    vi.spyOn(mockAPI.channels, "editMessage").mockRejectedValueOnce(
      new Error("message was deleted"),
    );

    await expect(
      handler.handle({
        interaction: buttonInteraction("tool-approval:approve:a1", "user-1"),
        discord,
        customId: "tool-approval:approve:a1",
      }),
    ).resolves.toBeUndefined();

    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
  });

  it("swallows a followUp failure without throwing", async () => {
    const { handler, discord, mockAPI } = setup();
    vi.spyOn(mockAPI.interactions, "followUp").mockRejectedValueOnce(
      new Error("unknown interaction"),
    );

    await expect(
      handler.handle({
        interaction: buttonInteraction("tool-approval:approve:missing", "user-1"),
        discord,
        customId: "tool-approval:approve:missing",
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows an editMessage failure thrown as a non-Error value", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());
    vi.spyOn(mockAPI.channels, "editMessage").mockRejectedValueOnce("plain string reason");

    await expect(
      handler.handle({
        interaction: buttonInteraction("tool-approval:approve:a1", "user-1"),
        discord,
        customId: "tool-approval:approve:a1",
      }),
    ).resolves.toBeUndefined();
    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
  });

  it("swallows a followUp failure thrown as a non-Error value", async () => {
    const { handler, discord, mockAPI } = setup();
    vi.spyOn(mockAPI.interactions, "followUp").mockRejectedValueOnce({ code: "boom" });

    await expect(
      handler.handle({
        interaction: buttonInteraction("tool-approval:approve:missing", "user-1"),
        discord,
        customId: "tool-approval:approve:missing",
      }),
    ).resolves.toBeUndefined();
  });

  it("falls back to the read state when decide() returns null mid-flight", async () => {
    const { store, handler, discord, mockAPI } = setup();
    await store.create(baseApprovalState());
    // Simulate the row being evicted between the initial `get` and `decide`,
    // so `const finalState = updated ?? state` picks the `state` branch.
    vi.spyOn(store, "decide").mockResolvedValueOnce(null);

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(mockAPI.callsTo("channels.editMessage")).toHaveLength(1);
  });
});

describe("toolApproval — default store fallback", () => {
  it("falls back to a fresh ApprovalStore() when none is injected", async () => {
    // No injected store → handler constructs `new ApprovalStore()`, which
    // pulls the mocked `Redis.fromEnv()` in-memory backend. The row doesn't
    // exist there, so the handler reports the approval as expired.
    const handler = buildToolApprovalHandler();
    const mockAPI = createMockAPI();

    await handler.handle({
      interaction: buttonInteraction("tool-approval:approve:nothing", "user-1"),
      discord: asAPI(mockAPI) as API,
      customId: "tool-approval:approve:nothing",
    });

    const follows = mockAPI.callsTo("interactions.followUp");
    expect((follows[0]![2] as { content: string }).content).toMatch(/expired/);
  });
});
