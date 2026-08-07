import { env as runtimeEnv } from "../../../lib/env.ts";

/** Typed SDK configuration; execution is denied before this fallback can be used. */
export const env = { VERCEL_API_TOKEN: runtimeEnv.VERCEL_API_TOKEN ?? "" };
