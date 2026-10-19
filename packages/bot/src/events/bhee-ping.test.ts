import { describe, expect, mock, test } from "bun:test";

import { DISCORD_IDS, UserRole } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import { Experimental_DecisionMockModelV4 as DecisionModel } from "ai/test";
import { ChannelType } from "discord.js";
import type { MessageReplyOptions } from "discord.js";

import { hasBheeEntryCue, isHackNightActive, pingOrganizersIfNeeded } from "./bhee-ping.ts";

type PingMessage = Parameters<typeof pingOrganizersIfNeeded>[0];
const FRIDAY_NIGHT = new Date("2026-10-17T01:30:00Z");
const TUESDAY_AFTERNOON = new Date("2026-10-13T18:00:00Z");
const HACK_NIGHT = {
  id: DISCORD_IDS.channels.HACK_NIGHT,
  name: "⚡hack-night",
  type: ChannelType.GuildText,
  parentId: "100000000000000001",
} satisfies PingMessage["channel"];
const PUBLIC_THREAD = {
  id: "100000000000000002",
  name: "tonight's projects",
  type: ChannelType.PublicThread,
  parentId: DISCORD_IDS.channels.HACK_NIGHT,
  parent: { name: HACK_NIGHT.name },
} satisfies PingMessage["channel"];

function source(overrides: Partial<PingMessage> = {}, senderRole: UserRole = UserRole.Public) {
  const reply = mock(async (options: MessageReplyOptions) => options);
  const doDecide = mock<DecisionModel["doDecide"]>(async () => ({
    answers: { needsLetIn: { type: "boolean", probability: 0.99 } },
    usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
    warnings: [],
  }));
  const model = new DecisionModel({ doDecide });
  const message = {
    content: "can someone let me into bhee",
    createdAt: FRIDAY_NIGHT,
    channel: HACK_NIGHT,
    mentions: { roles: new Set<string>() },
    reply,
    ...overrides,
  };
  return {
    reply,
    doDecide,
    run: () => pingOrganizersIfNeeded(message, senderRole, model),
  };
}

describe("entry cues", () => {
  test.each([
    "can someone let me into bhee",
    "im outside the front doors",
    "locked out of EE",
    "anyone near the side entrance?",
    "at the door, can someone open up",
    "can someone let us in",
    "let me in please",
    "how do i get into bhee",
  ])("classifies a candidate: %s", (content) => {
    expect(hasBheeEntryCue(content)).toBe(true);
  });

  test.each(["", "working on my compiler", "happy hack night!", "pizza in the lounge"])(
    "ignores unrelated chat: %s",
    (content) => expect(hasBheeEntryCue(content)).toBe(false),
  );
});

describe("Hack Night activity", () => {
  test("uses the channel prefix outside the weekly window", () => {
    expect(isHackNightActive("⚡hack-night", TUESDAY_AFTERNOON)).toBe(true);
    expect(isHackNightActive("🎃hack-night", TUESDAY_AFTERNOON)).toBe(true);
    expect(isHackNightActive("🌙hack-night", TUESDAY_AFTERNOON)).toBe(false);
    expect(isHackNightActive(undefined, TUESDAY_AFTERNOON)).toBe(false);
    expect(isHackNightActive("", TUESDAY_AFTERNOON)).toBe(false);
  });

  test.each([
    ["2026-10-16T22:59:59Z", false],
    ["2026-10-16T23:00:00Z", true],
    ["2026-10-17T09:59:59Z", true],
    ["2026-10-17T10:00:00Z", false],
    ["2026-01-16T23:59:59Z", false],
    ["2026-01-17T00:00:00Z", true],
    ["2026-01-17T10:59:59Z", true],
    ["2026-01-17T11:00:00Z", false],
  ])("uses Indiana time at %s", (instant, active) => {
    expect(isHackNightActive("🌙hack-night", new Date(instant))).toBe(active);
    expect(isHackNightActive(undefined, new Date(instant))).toBe(active);
  });
});

describe("organizer pings", () => {
  test.each([HACK_NIGHT, PUBLIC_THREAD])("replies to requests in $name", async (channel) => {
    const { run, reply, doDecide } = source({
      channel,
      content: "  im outside bhee can someone let me in  ",
    });
    expect(Result.isOk(await run())).toBe(true);
    expect(doDecide).toHaveBeenCalledTimes(1);
    expect(doDecide.mock.calls[0]?.[0].state).toEqual([
      { type: "text", text: "im outside bhee can someone let me in" },
    ]);
    expect(reply.mock.calls).toEqual([
      [
        {
          content: `<@&${DISCORD_IDS.roles.ORGANIZER}> someone needs to be let into BHEE!`,
          allowedMentions: { roles: [DISCORD_IDS.roles.ORGANIZER], repliedUser: true },
        },
      ],
    ]);
  });

  test.each([0, 0.5, 0.899, 0.9, 1])(
    "applies the probability threshold at %s",
    async (probability) => {
      const { run, reply, doDecide } = source();
      doDecide.mockResolvedValueOnce({
        answers: { needsLetIn: { type: "boolean", probability } },
        usage: {},
        warnings: [],
      });
      expect(Result.isOk(await run())).toBe(true);
      expect(reply).toHaveBeenCalledTimes(Number(probability >= 0.9));
    },
  );

  test("does not retry or reply when classification fails", async () => {
    const { run, reply, doDecide } = source();
    doDecide.mockRejectedValueOnce(new Error("gateway unavailable"));
    const result = await run();
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error.operation).toBe("classify BHEE entry request");
    expect(doDecide).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
  });

  test.each([{}, { needsLetIn: { type: "boolean", probability: 2 } }])(
    "rejects malformed decisions",
    async (answers) => {
      const { run, reply, doDecide } = source();
      doDecide.mockResolvedValueOnce({ answers, usage: {}, warnings: [] });
      expect(Result.isError(await run())).toBe(true);
      expect(reply).not.toHaveBeenCalled();
    },
  );

  test("reports a failed Discord reply", async () => {
    const { run, reply } = source();
    reply.mockRejectedValueOnce(new Error("missing permissions"));
    const result = await run();
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result))
      expect(result.error.operation).toBe("ping organizers for BHEE entry");
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

describe("local filters", () => {
  test.each([
    { content: "working on a compiler" },
    { content: "   " },
    { channel: { ...HACK_NIGHT, id: DISCORD_IDS.channels.SHIP } },
    { channel: { ...PUBLIC_THREAD, parentId: DISCORD_IDS.channels.SHIP } },
    { channel: { ...PUBLIC_THREAD, type: ChannelType.PrivateThread } },
    { channel: { ...HACK_NIGHT, name: "🌙hack-night" }, createdAt: TUESDAY_AFTERNOON },
    {
      channel: { ...PUBLIC_THREAD, parent: { name: "🌙hack-night" } },
      createdAt: TUESDAY_AFTERNOON,
    },
    { mentions: { roles: new Set<string>([DISCORD_IDS.roles.ORGANIZER]) } },
  ])("skips classification and replies for %j", async (overrides) => {
    const { run, reply, doDecide } = source(overrides);
    expect(Result.isOk(await run())).toBe(true);
    expect(doDecide).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  test.each([UserRole.Organizer, UserRole.Admin])("ignores %s messages", async (role) => {
    const { run, reply, doDecide } = source({}, role);
    expect(Result.isOk(await run())).toBe(true);
    expect(doDecide).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});
