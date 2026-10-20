import { expect, test } from "bun:test";

import { Result } from "@repo/shared/result";
import type { RenderIntent, RenderTarget } from "@repo/shared/wire";
import type { InteractionEditReplyOptions } from "discord.js";

import { handleWorkCard, type WorkCardInteraction } from "./work-card-interaction.ts";
import { workCardCustomId } from "./work-card.ts";

const intent: RenderIntent = {
  dispatchId: "c9b24619-5475-4e40-aeb0-803eeb06df88",
  continuationKey: "100000000000000001",
  messageId: "100000000000000002",
  sessionId: "session-private-reference",
  eveTurnId: "turn-example",
  revision: 3,
  phase: "completed",
  text: "The event has been updated.",
  activity: "calling cms_events_update",
  footer: "`privateid` · 10.0s · 1,000 tokens",
};
const target: RenderTarget = {
  dispatchId: intent.dispatchId,
  continuationKey: intent.continuationKey,
  messageId: intent.messageId,
  channelId: intent.continuationKey,
  authChannelId: intent.continuationKey,
  requesterUserId: "100000000000000003",
};
const MESSAGE = "100000000000000004";
const GUILD = "100000000000000005";

function fixture(
  options: { readonly text?: string; readonly expired?: boolean; readonly broken?: boolean } = {},
) {
  const order: string[] = [];
  const responses: InteractionEditReplyOptions[] = [];
  const errors: unknown[] = [];
  const deps = {
    guildId: GUILD,
    renders: {
      intent: async () => {
        order.push("intent");
        if (options.broken) throw new Error("Redis unavailable");
        return Result.ok(
          options.expired ? undefined : { ...intent, text: options.text ?? intent.text },
        );
      },
      target: async () => Result.ok(target),
      projection: async () =>
        Result.ok({
          anchorMessageId: MESSAGE,
          overflow: [],
          appliedRevision: 3,
          workCard: { title: "Update the event" },
        }),
    },
    reporter: {
      emit: (event: unknown) => {
        errors.push(event);
      },
      captureDefect: (cause: unknown) => {
        errors.push(cause);
      },
    },
  };
  const interaction: WorkCardInteraction = {
    customId: workCardCustomId(intent.dispatchId, 3, "details"),
    channelId: target.channelId,
    guildId: GUILD,
    messageId: MESSAGE,
    defer: async () => {
      order.push("defer");
    },
    respond: async (message) => {
      responses.push(message);
    },
    access: async () => ({ visible: true, diagnostics: true }),
  };
  return { deps, interaction, order, responses, errors };
}

test("acknowledges privately before loading; current requester diagnostics remain available", async () => {
  const f = fixture();
  await handleWorkCard(f.deps, f.interaction);
  expect(f.order[0]).toBe("defer");
  expect(f.responses[0]?.content).toContain("session-private-reference");
  expect(f.responses[0]?.content).toContain("1,000 tokens");
  expect(f.responses[0]?.allowedMentions).toEqual({ parse: [] });
});

test("old read-only buttons show current state; a future revision is refused", async () => {
  const f = fixture();
  await handleWorkCard(f.deps, {
    ...f.interaction,
    customId: workCardCustomId(intent.dispatchId, 1, "details"),
  });
  expect(f.responses[0]?.content).toContain("Current state: ready");
  await handleWorkCard(f.deps, {
    ...f.interaction,
    customId: workCardCustomId(intent.dispatchId, 4, "details"),
  });
  expect(f.responses[1]?.content).toContain("expired or been replaced");
});

test("an expired record, replaced anchor, wrong channel or wrong guild cannot expose task data", async () => {
  const expired = fixture({ expired: true });
  await handleWorkCard(expired.deps, expired.interaction);
  expect(expired.responses[0]?.content).toContain("expired");
  for (const overrides of [
    { messageId: "100000000000000099" },
    { channelId: "100000000000000099" },
    { guildId: "100000000000000099" },
  ]) {
    const f = fixture();
    await handleWorkCard(f.deps, { ...f.interaction, ...overrides });
    expect(f.responses[0]?.content).toContain("expired");
    expect(f.responses[0]?.content).not.toContain("private");
  }
});

test("revoked channel access fails closed even for a requester", async () => {
  const f = fixture();
  await handleWorkCard(f.deps, {
    ...f.interaction,
    access: async () => ({ visible: false, diagnostics: true }),
  });
  expect(f.responses[0]?.content).toContain("no longer have access");
  expect(f.responses[0]?.content).not.toContain("private");
});

test("channel viewers see public state and full results but no private diagnostics", async () => {
  const f = fixture();
  const viewer = { ...f.interaction, access: async () => ({ visible: true, diagnostics: false }) };
  await handleWorkCard(f.deps, viewer);
  expect(f.responses[0]?.content).toContain("Current state");
  expect(f.responses[0]?.content).not.toContain("private");
  expect(f.responses[0]?.content).not.toContain("cms_events_update");
  await handleWorkCard(f.deps, {
    ...viewer,
    customId: workCardCustomId(intent.dispatchId, 3, "result"),
  });
  expect(f.responses[1]?.content).toBe(intent.text);
});

test("full result delivers every saved character with mentions disabled", async () => {
  const text = "<@100000000000000003> @everyone 🪿\n".repeat(200);
  const f = fixture({ text });
  await handleWorkCard(f.deps, {
    ...f.interaction,
    customId: workCardCustomId(intent.dispatchId, 3, "result"),
  });
  expect(f.responses[0]).toMatchObject({
    files: [{ name: "wack-response.md", attachment: Buffer.from(text, "utf8") }],
    allowedMentions: { parse: [] },
  });
});

test("temporary read and permission failures produce a recoverable private response", async () => {
  const f = fixture({ broken: true });
  await handleWorkCard(f.deps, f.interaction);
  expect(f.responses[0]?.content).toContain("temporarily unavailable");
  expect(f.errors).toHaveLength(1);
  const permissions = fixture();
  await handleWorkCard(permissions.deps, {
    ...permissions.interaction,
    access: async () => {
      throw new Error("Discord timeout");
    },
  });
  expect(permissions.responses[0]?.content).toContain("temporarily unavailable");
});
