import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { isSimEnabled } from "@/lib/simulator/guard";

import crons from "./routes/crons";
import gateway from "./routes/gateway";
import interactions from "./routes/interactions";
import simulator from "./routes/simulator";

const discord = new Hono();
discord.route("/", gateway);
discord.route("/", interactions);

export const app = new Hono<EvlogVariables>().basePath("/api");
app.use(cors());
app.use(evlog());
app.route("/discord", discord);
app.route("/", crons);

// Dev-only chat simulator. Mounted only behind the gate so its process-global
// transport swaps can never run in a real bot process.
if (isSimEnabled()) {
  app.route("/simulator", simulator);
}
