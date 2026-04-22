import type { API } from "@discordjs/core/http-only";

import { describe, expect, it } from "vitest";

import type { ApprovalState } from "@/lib/ai/approvals";
import type { DiscordInteraction } from "@/lib/protocol/types";

import { ApprovalStore } from "@/lib/ai/approvals";
import { InteractionType } from "@/lib/protocol/constants";
import { asAPI, createMemoryRedis } from "@/lib/test/fixtures";

import { buildToolApprovalHandler } from "./tool-approval";

function buildDiscordMock() {
  const calls: { method: string; args: unknown[] }[] = [];
  const mock = {
    channels: {
      editMessage: async (channelId: string, msgId: string, body: unknown) => {
        calls.push({ method: "channels.editMessage", args: [channelId, msgId, body] });
        return { id: msgId };
      },
    },
    interactions: {
      followUp: async (appId: string, token: string, body: unknown) => {
        calls.push({ method: "interactions.followUp", args: [appId, token, body] });
        return { id: "followup-1" };
      },
    },
    _calls: calls,
  };
  return { mock, calls };
}

function buildInteraction(customId: string, clickerId: string): DiscordInteraction {
  return {
    id: "i-1",
    application_id: "app-1",
    type: InteractionType.MessageComponent,
    token: "tok-1",
    version: 1,
    member: {
      user: { id: clickerId, username: "alice" },
      roles: [],
    },
    data: { custom_id: customId, component_type: 2 },
  };
}

function seed(
  store: ApprovalStore,
  overrides: Partial<ApprovalState> = {},
): Promise<ApprovalState> {
  const state: ApprovalState = {
    id: "a1",
    status: "pending",
    toolName: "send_message",
    input: { content: "hi" },
    reason: "testing",
    channelId: "ch-1",
    messageId: "msg-5",
    requesterUserId: "user-1",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
  return store.create(state).then(() => state);
}

function setup() {
  const store = new ApprovalStore(createMemoryRedis());
  const handler = buildToolApprovalHandler(store);
  const { mock, calls } = buildDiscordMock();
  const discord = asAPI(mock as unknown as Parameters<typeof asAPI>[0]);
  return { store, handler, discord: discord as API, calls };
}

describe("toolApproval component handler", () => {
  it("edits the message and flips status when the requester clicks approve", async () => {
    const { store, handler, discord, calls } = setup();
    await seed(store);

    await handler.handle({
      interaction: buildInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(calls.some((c) => c.method === "channels.editMessage")).toBe(true);
    const edit = calls.find((c) => c.method === "channels.editMessage")!;
    expect(edit.args[1]).toBe("msg-5");
    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
    expect(after?.decidedByUserId).toBe("user-1");
  });

  it("sends an ephemeral follow-up and leaves state pending when a non-requester clicks", async () => {
    const { store, handler, discord, calls } = setup();
    await seed(store);

    await handler.handle({
      interaction: buildInteraction("tool-approval:approve:a1", "impostor"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(calls.some((c) => c.method === "channels.editMessage")).toBe(false);
    const follow = calls.find((c) => c.method === "interactions.followUp")!;
    expect(follow).toBeTruthy();
    expect((follow.args[2] as { content: string }).content).toMatch(/Only <@user-1>/);
    const after = await store.get("a1");
    expect(after?.status).toBe("pending");
  });

  it("sends an ephemeral reply when the approval is already decided", async () => {
    const { store, handler, discord, calls } = setup();
    await seed(store, { status: "approved", decidedByUserId: "user-1" });

    await handler.handle({
      interaction: buildInteraction("tool-approval:deny:a1", "user-1"),
      discord,
      customId: "tool-approval:deny:a1",
    });

    expect(calls.some((c) => c.method === "channels.editMessage")).toBe(false);
    const follow = calls.find((c) => c.method === "interactions.followUp")!;
    expect((follow.args[2] as { content: string }).content).toMatch(/already been approved/);
  });

  it("sends an ephemeral reply when the approval has expired (missing row)", async () => {
    const { handler, discord, calls } = setup();

    await handler.handle({
      interaction: buildInteraction("tool-approval:approve:missing", "user-1"),
      discord,
      customId: "tool-approval:approve:missing",
    });

    const follow = calls.find((c) => c.method === "interactions.followUp")!;
    expect((follow.args[2] as { content: string }).content).toMatch(/expired/);
  });

  it("ignores malformed custom ids", async () => {
    const { handler, discord, calls } = setup();

    await handler.handle({
      interaction: buildInteraction("tool-approval::a1", "user-1"),
      discord,
      customId: "tool-approval::a1",
    });

    const follow = calls.find((c) => c.method === "interactions.followUp");
    expect(follow).toBeTruthy();
    expect((follow!.args[2] as { content: string }).content).toMatch(/Malformed/);
  });

  it("skips the message edit when no messageId was stored", async () => {
    const { store, handler, discord, calls } = setup();
    await seed(store, { messageId: undefined });

    await handler.handle({
      interaction: buildInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(calls.some((c) => c.method === "channels.editMessage")).toBe(false);
    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
  });

  it("swallows an editMessage failure so the decision still persists", async () => {
    const { store } = setup();
    await seed(store);
    const calls: { method: string; args: unknown[] }[] = [];
    const mock = {
      channels: {
        editMessage: async (..._args: unknown[]) => {
          calls.push({ method: "channels.editMessage", args: _args });
          throw new Error("message was deleted");
        },
      },
      interactions: {
        followUp: async (appId: string, token: string, body: unknown) => {
          calls.push({ method: "interactions.followUp", args: [appId, token, body] });
          return { id: "f" };
        },
      },
    };
    const discord = asAPI(mock as unknown as Parameters<typeof asAPI>[0]) as API;
    const handler = buildToolApprovalHandler(store);

    await handler.handle({
      interaction: buildInteraction("tool-approval:approve:a1", "user-1"),
      discord,
      customId: "tool-approval:approve:a1",
    });

    expect(calls.some((c) => c.method === "channels.editMessage")).toBe(true);
    const after = await store.get("a1");
    expect(after?.status).toBe("approved");
  });

  it("swallows a followUp failure without throwing", async () => {
    const { store } = setup();
    const mock = {
      channels: { editMessage: async () => ({ id: "x" }) },
      interactions: {
        followUp: async () => {
          throw new Error("unknown interaction");
        },
      },
    };
    const discord = asAPI(mock as unknown as Parameters<typeof asAPI>[0]) as API;
    const handler = buildToolApprovalHandler(store);

    await expect(
      handler.handle({
        interaction: buildInteraction("tool-approval:approve:missing", "user-1"),
        discord,
        customId: "tool-approval:approve:missing",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects clicks from anonymous sources (no member, no user)", async () => {
    const { store, handler, discord, calls } = setup();
    await seed(store);
    const interaction = buildInteraction("tool-approval:approve:a1", "user-1");
    delete interaction.member;
    delete interaction.user;

    await handler.handle({
      interaction,
      discord,
      customId: "tool-approval:approve:a1",
    });

    const follow = calls.find((c) => c.method === "interactions.followUp");
    expect((follow!.args[2] as { content: string }).content).toMatch(/identify/i);
    const after = await store.get("a1");
    expect(after?.status).toBe("pending");
  });
});
