import { initLogger } from "evlog";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { art } from "./lib/ascii";
import crons from "./server/routes/crons";
import gateway from "./server/routes/gateway";
import inbound from "./server/routes/inbound";
import interactions from "./server/routes/interactions";

initLogger({ env: { service: "wack-hacker" } });

const discord = new Hono();
discord.route("/", gateway);
discord.route("/", inbound);
discord.route("/", interactions);

const api = new Hono();
api.route("/discord", discord);
api.route("/", crons);

const app = new Hono<EvlogVariables>();
app.use(cors());
app.use(evlog());
app.get("/", (c) => c.text(art));
app.route("/api", api);

export default app;
