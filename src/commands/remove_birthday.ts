import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import { getState, setState } from "../utils/state";

export const data = new SlashCommandBuilder()
  .setName("rm_birthday")
  .setDescription("Make me forget your birthday!");

export async function command(interaction: ChatInputCommandInteraction) {
  const { options } = interaction;

  const state = await getState();

  if (!state.birthdays) {
    await interaction.reply({
      content: "i don't have any birthdays?? oopsie ask ray for help",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = state.birthdays.find((b) => b.userId === interaction.user.id);

  if (!user) {
    await interaction.reply({
      content: "i already forgot your birthday! you goober!",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const newBirthdays = state.birthdays.filter(
    (b) => b.userId !== interaction.user.id,
  );

  await setState({ ...state, birthdays: newBirthdays });

  await interaction.reply({
    content: "i forgot your birthday! you're freeeeee!",
    flags: MessageFlags.Ephemeral,
  });
}
