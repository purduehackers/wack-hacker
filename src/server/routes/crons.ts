import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { Hono } from "hono";

import type { CronHandler } from "@/bot/crons/types";

import * as crons from "@/bot/handlers/crons";
import { env } from "@/env";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";

const cronMap = new Map((Object.values(crons) as CronHandler[]).map((c) => [c.name, c]));

const route = new Hono();

route.get("/crons/:name", async (c) => {
  // Vercel crons attach `Authorization: Bearer ${CRON_SECRET}` on every invocation.
  // Any other caller — including a leaked URL — is rejected here so cron
  // handlers cannot be triggered externally.
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    createWideLogger({ op: "cron.execute" }).emit({ outcome: "unauthorized" });
    return c.json({ error: "Unauthorized" }, 401);
  }

  const name = c.req.param("name");
  const cron = cronMap.get(name);
  if (!cron) {
    createWideLogger({ op: "cron.execute", cron: { name } }).emit({ outcome: "unknown" });
    return c.json({ error: `Unknown cron: ${name}` }, 404);
  }

  return withSpan("cron.execute", { "cron.name": name }, async () => {
    const logger = createWideLogger({ op: "cron.execute", cron: { name } });
    const startTime = Date.now();
    const discord = new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
    try {
      await cron.handle(discord);
      countMetric("cron.completed", { name });
      logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
      return c.json({ ok: true, cron: name });
    } catch (err) {
      countMetric("cron.error", { name });
      logger.error(err as Error);
      logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
      throw err;
    } finally {
      recordDuration("cron.duration", Date.now() - startTime, { name });
    }
  });
});

export default route;
