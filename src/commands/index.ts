import type {
  ChatInputCommandInteraction,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";

import * as adminCheckBirthdays from "./admin_check_birthdays";
import * as adminGetCurrentTime from "./admin_get_current_time";
import * as birthday from "./birthday";
import * as removeBirthday from "./remove_birthday";
import * as summarize from "./summarize";

type Command = {
  data: SlashCommandOptionsOnlyBuilder;
  command: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

export const commands: Command[] = [
  adminCheckBirthdays,
  adminGetCurrentTime,
  birthday,
  removeBirthday,
  summarize,
];
