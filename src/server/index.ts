import { Hono } from "hono";

import { art } from "../lib/ascii";
import { registerHandlers } from "../lib/bot/handlers";
import discord from "./routes/discord";
import webhooks from "./routes/webhooks";

registerHandlers();

const api = new Hono();
api.route("/webhooks", webhooks);
api.route("/discord", discord);

const app = new Hono();
app.get("/", (c) => c.text(art));
app.route("/api", api);

export default app;
