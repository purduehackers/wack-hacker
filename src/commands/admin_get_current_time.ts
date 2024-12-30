import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import { ADMINS } from "../utils/consts";

dayjs.extend(advancedFormat);

export const data = new SlashCommandBuilder()
  .setName("admin_get_current_time")
  .setDescription("ADMIN");

export async function command(interaction: ChatInputCommandInteraction) {
  if (!ADMINS.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You do not have permission to run this command",
      ephemeral: true,
    });
    return;
  }

  const now = dayjs();

  await interaction.reply({
    content: `Container time: ${now.format("YYYY-MM-DD HH:mm:ss")}. Timezone: ${Bun.env.TZ}`,
    ephemeral: true,
  });
}
