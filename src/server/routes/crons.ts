import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { log } from "evlog";
import { Hono } from "hono";

import type { CronHandler } from "@/lib/bot/crons/types";

import { env } from "@/env";
import * as crons from "@/lib/bot/handlers/crons";

const cronMap = new Map((Object.values(crons) as CronHandler[]).map((c) => [c.name, c]));

const route = new Hono();

route.get("/crons/:name", async (c) => {
  const name = c.req.param("name");
  const cron = cronMap.get(name);
  if (!cron) return c.json({ error: `Unknown cron: ${name}` }, 404);

  log.info("crons", `Running ${name}`);

  const discord = new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
  await cron.handle(discord);
  return c.json({ ok: true, cron: name });
});

export default route;
