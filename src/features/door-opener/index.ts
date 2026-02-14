import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { Effect, Redacted } from "effect";
import { AppConfig } from "../../config";
import { ORGANIZER_ROLE_ID } from "../../constants";

export const doorOpenerCommand = new SlashCommandBuilder()
  .setName("door-opener")
  .setDescription("Door opener commands")
  .addSubcommand((subcommand) =>
    subcommand.setName("open").setDescription("Open the door"),
  );

export const handleDoorOpenerCommand = Effect.fn("DoorOpener.handleCommand")(
  function* (interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    yield* Effect.annotateCurrentSpan({
      user_id: interaction.user.id,
      subcommand,
    });

    if (subcommand === "open") {
      const member = interaction.member;
      const memberRoles =
        member && "cache" in member.roles ? member.roles.cache : null;
      const isOrganizer = memberRoles?.has(ORGANIZER_ROLE_ID) ?? false;

      if (!isOrganizer) {
        yield* Effect.tryPromise(() =>
          interaction.reply({
            content: "You don't have permission to use this command.",
            flags: MessageFlags.Ephemeral,
          }),
        );
        return;
      }

      const env = yield* AppConfig;
      const response = yield* Effect.tryPromise(() =>
        fetch(
          new Request(env.PHONEBELL_OPEN_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Redacted.value(env.PHACK_API_TOKEN)}`,
            },
          }),
        ),
      );

      if (!response.ok) {
        yield* Effect.tryPromise(() =>
          interaction.reply({
            content: "Failed to open the door.",
            flags: MessageFlags.Ephemeral,
          }),
        );
        return;
      }

      yield* Effect.tryPromise(() =>
        interaction.reply({
          content: "Door opened!",
          flags: MessageFlags.Ephemeral,
        }),
      );
    }
  },
);
