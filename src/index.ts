import { Hono } from "hono";
import { cors } from "hono/cors";

import { art } from "./lib/ascii";

const api = new Hono();

const app = new Hono();
app.use(cors());
app.get("/", (c) => c.text(art));
app.route("/api", api);

export default app;
