import { type Client, Colors, EmbedBuilder } from "discord.js";
import {
  ATTENDANCE_CHANNEL_ID,
  KNIGHT_ROLE_ID,
  PROJECT_HACK_NIGHT_CHANNEL_ID,
} from "../utils/consts";

export default {
  name: "attendance",
  description: "Hourly attendance checks during Hack Night",
  channel: PROJECT_HACK_NIGHT_CHANNEL_ID,
  embed: (client: Client) =>
    new EmbedBuilder()
      .setColor(Colors.DarkOrange)
      .setTitle("⏰ REMINDER: Hack Night Attendance Check")
      .setDescription(
        `<@${KNIGHT_ROLE_ID}> please do an attendance run and post the results in <#${ATTENDANCE_CHANNEL_ID}>!\n\nConfirm this has been done by reacting with a ✅ to this message.`,
      ),
  crons: [
    "0 21-23 * * 5", // At minute 0 past every hour from 21 through 23 on Friday.
    "0 0-2 * * 6", // At minute 0 past every hour from 0 through 2 on Saturday.
  ],
};
