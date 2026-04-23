import { Hono } from "hono";

import type { CronHandler } from "@/bot/crons/types";

import * as crons from "@/bot/handlers/crons";
import { env } from "@/env";
import { createDiscordAPI } from "@/lib/discord/client";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { runInstrumented } from "@/lib/otel/instrumented";

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

  const startTime = Date.now();
  try {
    await runInstrumented(
      {
        op: "cron.execute",
        spanAttrs: { "cron.name": name },
        loggerContext: { cron: { name } },
      },
      async () => {
        await cron.handle(createDiscordAPI());
        countMetric("cron.completed", { name });
      },
    );
    return c.json({ ok: true, cron: name });
  } catch (err) {
    countMetric("cron.error", { name });
    throw err;
  } finally {
    recordDuration("cron.duration", Date.now() - startTime, { name });
  }
});

export default route;
