import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import crons from "./routes/crons";
import gateway from "./routes/gateway";
import inbound from "./routes/inbound";
import interactions from "./routes/interactions";

const discord = new Hono();
discord.route("/", gateway);
discord.route("/", inbound);
discord.route("/", interactions);

export const app = new Hono<EvlogVariables>().basePath("/api");
app.use(cors());
app.use(evlog());
app.route("/discord", discord);
app.route("/", crons);
