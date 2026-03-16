import { REST } from "@discordjs/rest";

import { env } from "../../../../env.ts";

export const discord = new REST().setToken(env.DISCORD_BOT_TOKEN);
