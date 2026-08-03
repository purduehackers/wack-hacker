import { NotFound } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter, WideEvent } from "@repo/shared/result/observe";
import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Interaction } from "discord.js";
import { expect, test } from "vitest";

import { asDouble } from "../test/double.ts";
import { defineCommand } from "./define.ts";
import { dispatchInteraction } from "./dispatch.ts";

function recordingReporter(): { reporter: Reporter; events: WideEvent[]; defects: unknown[] } {
  const events: WideEvent[] = [];
  const defects: unknown[] = [];
  return {
    events,
    defects,
    reporter: {
      emit: (wide) => void events.push(wide),
      captureDefect: (error) => void defects.push(error),
    },
  };
}

interface FakeInteraction {
  readonly replies: string[];
  readonly interaction: Interaction;
}

/** Models only the surface the dispatcher touches. */
function fakeInteraction(commandName: string, state?: { replied?: boolean }): FakeInteraction {
  const replies: string[] = [];
  const interaction = {
    commandName,
    replied: state?.replied ?? false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async (payload: { content?: string } | string) => {
      replies.push(typeof payload === "string" ? payload : (payload.content ?? ""));
    },
    followUp: async (payload: { content?: string } | string) => {
      replies.push(typeof payload === "string" ? payload : (payload.content ?? ""));
    },
  };
  return { replies, interaction: asDouble<Interaction>(interaction) };
}

const okCommand = defineCommand({
  builder: new SlashCommandBuilder().setName("ok").setDescription("succeeds"),
  execute: async (interaction) => {
    await interaction.reply("done");
    return Result.ok(undefined);
  },
});

const failingCommand = defineCommand({
  builder: new SlashCommandBuilder().setName("bad").setDescription("returns an error"),
  execute: async () => Result.err(new NotFound({ kind: "ship", id: "7" })),
});

const throwingCommand = defineCommand({
  builder: new SlashCommandBuilder().setName("boom").setDescription("throws"),
  execute: async () => {
    throw new Error("kaboom");
  },
});

test("a successful command replies and emits one ok event", async () => {
  const { reporter, events, defects } = recordingReporter();
  const { replies, interaction } = fakeInteraction("ok");

  await dispatchInteraction(interaction, { commands: [okCommand], reporter });

  expect(replies).toEqual(["done"]);
  expect(events).toHaveLength(1);
  expect(events[0]?.status).toBe("ok");
  expect(defects).toEqual([]);
});

test("an expected failure still answers the user and is not paged", async () => {
  const { reporter, events, defects } = recordingReporter();
  const { replies, interaction } = fakeInteraction("bad");

  await dispatchInteraction(interaction, { commands: [failingCommand], reporter });

  // Discord renders an unanswered interaction as "the application did not
  // respond", which reads as the whole bot being broken.
  expect(replies[0]).toContain("ship not found: 7");
  expect(events[0]?.status).toBe("error");
  expect(defects).toEqual([]);
});

test("a handler that throws is flattened onto the same path and reported", async () => {
  const { reporter, events, defects } = recordingReporter();
  const { replies, interaction } = fakeInteraction("boom");

  await dispatchInteraction(interaction, { commands: [throwingCommand], reporter });

  expect(replies[0]).toContain("kaboom");
  expect(events[0]?.status).toBe("defect");
  expect(defects).toHaveLength(1);
});

test("an unknown command is a defect, because it means deploy skew", async () => {
  const { reporter, defects } = recordingReporter();
  const { replies, interaction } = fakeInteraction("ghost");

  await dispatchInteraction(interaction, { commands: [okCommand], reporter });

  expect(replies).toEqual(["That command is no longer available."]);
  expect(defects).toHaveLength(1);
});

test("a failure after the handler already replied uses followUp", async () => {
  const { reporter } = recordingReporter();
  const { replies, interaction } = fakeInteraction("bad", { replied: true });

  await dispatchInteraction(interaction, { commands: [failingCommand], reporter });

  // reply() twice would throw; the dispatcher must notice it already answered.
  expect(replies).toHaveLength(1);
});

test("non-command interactions are ignored", async () => {
  const { reporter, events } = recordingReporter();
  const notACommand = asDouble<Interaction>({
    isChatInputCommand: () => false,
  });

  await dispatchInteraction(notACommand, { commands: [okCommand], reporter });

  expect(events).toEqual([]);
});

test("dispatch never rejects, so a listener cannot lose the error", async () => {
  const { reporter } = recordingReporter();
  const brokenReply = asDouble<ChatInputCommandInteraction>({
    commandName: "bad",
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    reply: async () => {
      throw new Error("interaction token expired");
    },
    followUp: async () => {
      throw new Error("interaction token expired");
    },
  });

  await expect(
    dispatchInteraction(brokenReply, { commands: [failingCommand], reporter }),
  ).resolves.toBeUndefined();
});
