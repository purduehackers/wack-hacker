import { type Client, Colors, EmbedBuilder } from "discord.js";
import {
  ATTENDANCE_CHANNEL_ID,
  KNIGHT_ROLE_ID,
  PROJECT_HACK_NIGHT_CHANNEL_ID,
} from "../utils/consts";

export default {
  name: "hack_night_setup",
  description: "Setting up for Hack Night",
  channel: PROJECT_HACK_NIGHT_CHANNEL_ID,
  embed: (client: Client) =>
    new EmbedBuilder()
      .setColor(Colors.DarkOrange)
      .setTitle("⏰ REMINDER: Set Up Hack Night")
      .setDescription(
        `<@${KNIGHT_ROLE_ID}> it's time to setup Hack Night! Make sure somebody is responsible for bringing the Hack Cart to Bechtel and setting up all the devices.\n\nRefer to https://puhack.horse/hn-setup for the checklist of things to do!\n\nConfirm this has been done by reacting with a ✅ to this message.`,
      ),
  crons: [
    "45 19 * * 5", // At 19:45 on Friday.
  ],
};
