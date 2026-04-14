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
  // Vercel crons attach `Authorization: Bearer ${CRON_SECRET}` on every invocation.
  // Any other caller — including a leaked URL — is rejected here so cron
  // handlers cannot be triggered externally.
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const name = c.req.param("name");
  const cron = cronMap.get(name);
  if (!cron) return c.json({ error: `Unknown cron: ${name}` }, 404);

  log.info("crons", `Running ${name}`);

  const discord = new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
  await cron.handle(discord);
  return c.json({ ok: true, cron: name });
});

export default route;
