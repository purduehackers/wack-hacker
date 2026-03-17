import { waitUntil } from "@vercel/functions";
import { Hono } from "hono";

import { bot } from "../../lib/bot";

const app = new Hono();

app.get("/gateway", async (c) => {
  await bot.initialize();

  const discord = bot.getAdapter("discord");
  if (!discord) {
    return c.text("Error: Discord adapter not configured", 500);
  }

  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/webhooks/discord`;
  const durationMs = 10 * 60 * 1000;

  return discord.startGatewayListener({ waitUntil }, durationMs, undefined, webhookUrl);
});

export default app;
