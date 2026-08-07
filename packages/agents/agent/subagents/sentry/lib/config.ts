import { env as runtimeEnv } from "../../../lib/env.ts";

/** Typed SDK configuration; execution is denied before these fallbacks can be used. */
export const env = {
  SENTRY_AUTH_TOKEN: runtimeEnv.SENTRY_AUTH_TOKEN ?? "",
  SENTRY_ORG: runtimeEnv.SENTRY_ORG ?? "",
};
