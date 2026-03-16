import { waitUntil } from "@vercel/functions";
import { Hono } from "hono";

import { bot } from "../../lib/bot";

type Platform = keyof typeof bot.webhooks;

const app = new Hono();

app.post("/:platform", async (c) => {
  const platform = c.req.param("platform") as Platform;

  const handler = bot.webhooks[platform];
  if (!handler) {
    return c.text(`Unknown platform: ${platform}`, 404);
  }

  return handler(c.req.raw, { waitUntil });
});

export default app;
