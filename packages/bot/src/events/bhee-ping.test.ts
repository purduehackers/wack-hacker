import { describe, expect, mock, test } from "bun:test";

import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { ChannelType } from "discord.js";
import type { MessageReplyOptions } from "discord.js";

import {
  type BheeClassifier,
  hasBheeEntryCue,
  isHackNightActive,
  isWithinHackNightWindow,
  organizerPingReply,
  pingOrganizersIfNeeded,
} from "./bhee-ping.ts";

// Friday 2026-10-16 21:30 EDT (01:30 UTC on Saturday 2026-10-17)
const FRIDAY_NIGHT = new Date("2026-10-17T01:30:00.000Z");
// Tuesday 2026-10-13 14:00 EDT (18:00 UTC)
const TUESDAY_AFTERNOON = new Date("2026-10-13T18:00:00.000Z");

function makeSource(overrides?: {
  readonly content?: string;
  readonly channelId?: string;
  readonly channelName?: string;
  readonly isThread?: boolean;
  readonly threadType?: ChannelType;
  readonly parentId?: string;
  readonly parentName?: string;
  readonly createdAt?: Date;
  readonly memberRoles?: readonly string[];
  readonly mentionedRoles?: readonly string[];
}) {
  const reply = mock(async (options: MessageReplyOptions) => options);
  const isThread = overrides?.isThread ?? false;
  const channelName = overrides?.channelName ?? "⚡hack-night";
  const parentName = overrides?.parentName ?? "⚡hack-night";
  const mentionedRoleSet = new Set(overrides?.mentionedRoles ?? []);

  const message = {
    id: "100000000000000001",
    content: overrides?.content ?? "can someone let me into bhee",
    createdAt: overrides?.createdAt ?? FRIDAY_NIGHT,
    channel: isThread
      ? {
          id: overrides?.channelId ?? "999999999999999999",
          type: overrides?.threadType ?? ChannelType.PublicThread,
          parentId: overrides?.parentId ?? DISCORD_IDS.channels.HACK_NIGHT,
          parent: { name: parentName },
          isThread: () => true,
        }
      : {
          id: overrides?.channelId ?? DISCORD_IDS.channels.HACK_NIGHT,
          name: channelName,
          isThread: () => false,
        },
    member: {
      roles: [...(overrides?.memberRoles ?? [])],
    },
    mentions: {
      roles: {
        has: (roleId: string) => mentionedRoleSet.has(roleId),
      },
    },
    reply,
  };

  return { message, reply };
}

function makeClassifier(verdict = true) {
  const isLetInRequest = mock(async (_content: string) => Result.ok(verdict));
  return { classifier: { isLetInRequest } satisfies BheeClassifier, isLetInRequest };
}

describe("hasBheeEntryCue", () => {
  test.each([
    "can someone let me into bhee",
    "im outside the front doors",
    "locked out of EE",
    "anyone near the side entrance?",
    "at the door, can someone open up",
    "how do i get into bhee",
  ])("matches candidate entry message: %s", (text) => {
    expect(hasBheeEntryCue(text)).toBe(true);
  });

  test.each([
    "what are you working on tonight?",
    "happy hack night everyone!",
    "check out this rust crate",
    "eating pizza in the lounge",
  ])("ignores unrelated chat: %s", (text) => {
    expect(hasBheeEntryCue(text)).toBe(false);
  });
});

describe("isHackNightActive & isWithinHackNightWindow", () => {
  test("considers Hack Night active when channel emoji prefix is not the resting moon", () => {
    expect(isHackNightActive("⚡hack-night", TUESDAY_AFTERNOON)).toBe(true);
    expect(isHackNightActive("🎃hack-night", TUESDAY_AFTERNOON)).toBe(true);
  });

  test("considers Hack Night inactive on a Tuesday when channel has the moon prefix", () => {
    expect(isHackNightActive("🌙hack-night", TUESDAY_AFTERNOON)).toBe(false);
  });

  test("falls back to the Friday night / Saturday morning window in Indiana time", () => {
    expect(isWithinHackNightWindow(FRIDAY_NIGHT)).toBe(true);
    expect(isHackNightActive("🌙hack-night", FRIDAY_NIGHT)).toBe(true);
    expect(isWithinHackNightWindow(TUESDAY_AFTERNOON)).toBe(false);
  });
});

describe("pingOrganizersIfNeeded delivery", () => {
  test("replies pinging organizers when a member in #hack-night asks to be let in", async () => {
    const { message, reply } = makeSource({ content: "im outside bhee can someone let me in" });
    const { classifier, isLetInRequest } = makeClassifier(true);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).toHaveBeenCalledWith("im outside bhee can someone let me in");
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]?.[0]).toEqual({
      content: organizerPingReply(),
      allowedMentions: {
        roles: [DISCORD_IDS.roles.ORGANIZER],
        repliedUser: true,
      },
    });
  });

  test("also monitors public threads under #hack-night", async () => {
    const { message, reply } = makeSource({
      isThread: true,
      content: "stuck at the front door of bhee!",
    });
    const { classifier, isLetInRequest } = makeClassifier(true);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  test("does not ping when the classifier says the message is not a let-in request", async () => {
    const { message, reply } = makeSource({ content: "heading to bhee in 20 minutes" });
    const { classifier, isLetInRequest } = makeClassifier(false);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
  });

  test("propagates classifier errors without replying", async () => {
    const { message, reply } = makeSource();
    const classifier: BheeClassifier = {
      isLetInRequest: async () =>
        Result.err(new Transient({ operation: "classify BHEE entry request", detail: "timeout" })),
    };

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isError(outcome)).toBe(true);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("pingOrganizersIfNeeded filtering", () => {
  test("skips LLM classification when the message has no entry keywords", async () => {
    const { message, reply } = makeSource({ content: "working on my compiler tonight" });
    const { classifier, isLetInRequest } = makeClassifier(true);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores messages outside #hack-night and its threads", async () => {
    const { message, reply } = makeSource({ channelId: DISCORD_IDS.channels.SHIP });
    const { classifier, isLetInRequest } = makeClassifier(true);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores messages when Hack Night is inactive", async () => {
    const { message, reply } = makeSource({
      channelName: "🌙hack-night",
      createdAt: TUESDAY_AFTERNOON,
    });
    const { classifier, isLetInRequest } = makeClassifier(true);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores messages sent by organizers or admins", async () => {
    const { message, reply } = makeSource({
      memberRoles: [DISCORD_IDS.roles.ORGANIZER],
    });
    const { classifier, isLetInRequest } = makeClassifier(true);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores messages that already mention the organizer role", async () => {
    const { message, reply } = makeSource({
      mentionedRoles: [DISCORD_IDS.roles.ORGANIZER],
    });
    const { classifier, isLetInRequest } = makeClassifier(true);

    const outcome = await pingOrganizersIfNeeded(message, classifier);
    expect(Result.isOk(outcome)).toBe(true);
    expect(isLetInRequest).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});
