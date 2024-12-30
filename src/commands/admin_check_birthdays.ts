import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import { getBirthdaysToday } from "./birthday";
import { ADMINS } from "../utils/consts";

dayjs.extend(utc);

export const data = new SlashCommandBuilder()
  .setName("admin_check_birthdays")
  .setDescription("ADMIN")
  .addStringOption((option) =>
    option
      .setName("month")
      .setDescription("Month to test")
      .addChoices(
        { name: "January", value: "0" },
        { name: "February", value: "1" },
        { name: "March", value: "2" },
        { name: "April", value: "3" },
        { name: "May", value: "4" },
        { name: "June", value: "5" },
        { name: "July", value: "6" },
        { name: "August", value: "7" },
        { name: "September", value: "8" },
        { name: "October", value: "9" },
        { name: "November", value: "10" },
        { name: "December", value: "11" },
      )
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName("day")
      .setDescription("Day to test")
      .setMinValue(1)
      .setMaxValue(31)
      .setRequired(false),
  );

export async function command(interaction: ChatInputCommandInteraction) {
  const { options } = interaction;

  const month = options.getString("month");
  const day = options.getInteger("day");

  if ((month && !day) || (!month && day)) {
    await interaction.reply({
      content: "Please provide both a month and day",
      ephemeral: true,
    });
    return;
  }

  if (!ADMINS.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You do not have permission to run this command",
      ephemeral: true,
    });
    return;
  }

  const date =
    month && day
      ? dayjs.utc(0).month(Number(month)).date(Number(day))
      : dayjs.utc();

  const birthdays = await getBirthdaysToday(date);

  if (birthdays.length === 0) {
    await interaction.reply({
      content: "No birthdays",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `Birthdays: ${birthdays.map((b) => `<@${b.userId}>`).join(", ")}`,
    ephemeral: true,
  });
}
