import { handle } from "hono/vercel";

import { app } from "@/server";

export const GET = handle(app);
export const POST = handle(app);
