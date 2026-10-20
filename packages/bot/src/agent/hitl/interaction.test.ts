import { expect, spyOn, test } from "bun:test";

import { Result } from "@repo/shared/result";
import type { RenderIntent, RenderTarget } from "@repo/shared/wire";
import { ButtonInteraction, Client } from "discord.js";
import { z } from "zod";

import { createHitlInteractionHandler } from "./interaction.ts";

const requesterId = "100000000000000001";
const channelId = "100000000000000002";
const guildId = "100000000000000003";
const messageId = "100000000000000004";
const dispatchId = "53ca2d9e-8f6b-4c7f-a129-651fe321b035";
const user = { id: requesterId, username: "requester", discriminator: "0" };
const message = {
  id: messageId,
  channel_id: channelId,
  author: user,
  content: "Approve operation?",
  timestamp: "2026-10-19T12:00:00.000Z",
  components: [
    { type: 1, components: [{ type: 2, custom_id: "approve", label: "Approve", style: 3 }] },
  ],
  embeds: [],
  attachments: [],
  mentions: [],
  mention_roles: [],
};

function intent(): RenderIntent {
  return {
    dispatchId,
    continuationKey: channelId,
    messageId,
    sessionId: "session",
    eveTurnId: "turn",
    revision: 1,
    phase: "streaming",
    text: "",
    activity: "waiting for input…",
    inputRequests: [
      {
        kind: "tool-approval",
        requestId: "request",
        recipientUserId: requesterId,
        prompt: "Approve operation?",
        options: [{ id: "approve", label: "Approve" }],
      },
    ],
  };
}

test("an accepted response submission cannot overwrite a rejection paint in either order", async () => {
  for (const paintBeforeAck of [true, false]) {
    const client = new Client({ intents: [] });
    // Discord constructs this class internally; Reflect exercises its actual
    // runtime parsing without logging a test client into Discord.
    const interaction: ButtonInteraction = Reflect.construct(ButtonInteraction, [
      client,
      {
        id: "100000000000000005",
        application_id: "100000000000000006",
        type: 3,
        token: "test-token",
        version: 1,
        channel: { id: channelId, type: 0 },
        guild_id: guildId,
        user,
        locale: "en-US",
        entitlements: [],
        authorizing_integration_owners: {},
        attachment_size_limit: 1000,
        data: { component_type: 2, custom_id: `eve-hitl:i:${dispatchId}:1:0:o0` },
        message,
      },
    ]);
    const publicWrites: string[] = [];
    const receipts: string[] = [];
    const post = spyOn(client.rest, "post").mockResolvedValue({});
    const patch = spyOn(client.rest, "patch").mockImplementation(async (route, options) => {
      if (route.startsWith("/channels/")) publicWrites.push(route);
      const content = z.object({ body: z.object({ content: z.string() }) }).safeParse(options).data
        ?.body.content;
      if (content !== undefined) receipts.push(content);
      return { ...message, content: content ?? "", flags: 64 };
    });
    let current = intent();
    const target: RenderTarget = {
      dispatchId,
      continuationKey: channelId,
      messageId,
      channelId,
      authChannelId: channelId,
      requesterUserId: requesterId,
      anchorMessageId: messageId,
    };
    const repaintRejected = () => {
      current = { ...current, revision: 2 };
    };
    const handler = createHitlInteractionHandler({
      guildId,
      flow: {
        answer: async () => {
          if (paintBeforeAck) repaintRejected();
          return { status: "accepted" };
        },
      },
      renders: {
        intent: async () => Result.ok(current),
        target: async () => Result.ok(target),
        projection: async () =>
          Result.ok({
            anchorMessageId: messageId,
            overflow: [],
            appliedRevision: current.revision,
          }),
      },
      challenges: { challenge: async () => Result.ok(undefined) },
      reporter: {
        emit: (event) => {
          throw new Error(JSON.stringify(event));
        },
        captureDefect: (error) => {
          throw error;
        },
      },
    });
    try {
      expect(await handler(interaction)).toBe(true);
      if (!paintBeforeAck) repaintRejected();
      expect(receipts).toEqual(["Response submitted."]);
      expect(publicWrites).toEqual([]);
      expect(current.revision).toBe(2);
      expect(current.inputRequests).toHaveLength(1);
      expect(interaction.message.components).toHaveLength(1);
    } finally {
      post.mockRestore();
      patch.mockRestore();
      await client.destroy();
    }
  }
});
