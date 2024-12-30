import dayjs, { type Dayjs } from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import utc from "dayjs/plugin/utc";
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import { getState, setState } from "../utils/state";

dayjs.extend(advancedFormat);
dayjs.extend(utc);

export const data = new SlashCommandBuilder()
  .setName("birthday")
  .setDescription("Let me remember your birthday!")
  .addStringOption((option) =>
    option
      .setName("month")
      .setDescription("Month of your birthday")
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
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("day")
      .setDescription("Day of your birthday")
      .setMinValue(1)
      .setMaxValue(31)
      .setRequired(true),
  );

export async function command(interaction: ChatInputCommandInteraction) {
  const { options } = interaction;

  const month = options.getString("month", true);
  const day = options.getInteger("day", true);

  if (!month) {
    await interaction.reply({
      content: "Please provide a month",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!day) {
    await interaction.reply({
      content: "Please provide a day",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const monthsWith31Days = ["0", "2", "4", "6", "7", "9", "11"];

  if (!monthsWith31Days.includes(month) && day === 31) {
    await interaction.reply({
      content: "Invalid day for this month",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const date = dayjs.utc(0).set("month", Number(month)).set("date", day);

  try {
    await setBirthday(interaction.user.id, date.toDate());
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "failed to set birthday :( please let ray know",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (date.isSame(dayjs.utc(), "day")) {
    await interaction.reply({
      content: "happy birthday!!! :D added your birthday!",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `added your birthday as ${date.format("MMMM Do").toLowerCase()}! :)`,
    flags: MessageFlags.Ephemeral,
  });
}

async function setBirthday(userId: string, date: Date) {
  const state = await getState();
  const birthdays = state.birthdays ?? [];

  const userBirthday = birthdays.find((b) => b.userId === userId);

  if (userBirthday) {
    userBirthday.date = date.toISOString();
  } else {
    birthdays.push({
      userId: userId,
      date: date.toISOString(),
    });
  }

  await setState({ ...state, birthdays });
}

export async function getBirthdaysToday(date?: Dayjs) {
  const state = await getState();
  const birthdays = state.birthdays ?? [];

  return birthdays.filter((b) => {
    const birthday = dayjs.utc(b.date);
    const day = date ? date.date() : dayjs.utc().date();
    const month = date ? date.month() : dayjs.utc().month();

    return birthday.date() === day && birthday.month() === month;
  });
}

export function generateBirthdayMessage(userId: string) {
  const rats = [
    // "636701123620634653", // @rayhanadev
    "1323107429164122225", // @theshadoweevee
  ];

  if (rats.includes(userId)) {
    return `Rats, rats, we are the rats, celebrating yet another birthday bash. <@${userId}>, it's your birthday today. Cake and ice-cream is on its way, and ${userId}'s been such a good boy this year! Open up your gifts while we all cheer!`;
  }

  return `<@${userId}> happy birthday!!! :D`;
}
