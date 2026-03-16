import { REST } from "@discordjs/rest";

import { env } from "../../../../env";

export const discord = new REST().setToken(env.DISCORD_BOT_TOKEN);
