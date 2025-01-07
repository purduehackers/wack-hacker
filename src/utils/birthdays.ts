import type { Client } from "discord.js";

import {
  getBirthdaysToday,
  generateBirthdayMessage,
} from "../commands/birthday";
import { LOUNGE_CHANNEL_ID } from "./consts";

export function checkBirthdays(client: Client) {
  return async function () {
    const birthdays = await getBirthdaysToday();

    if (birthdays.length === 0) return;

    const channel = client.channels.cache.get(LOUNGE_CHANNEL_ID);

    if (!channel) {
      console.error("Could not find channel: #lounge");
      return;
    }

    if (!channel.isSendable()) {
      console.error("Cannot send messages to #lounge");
      return;
    }

    for (const birthday of birthdays) {
      channel.send({
        content: generateBirthdayMessage(birthday.userId),
      });
    }
  };
}
