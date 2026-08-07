import { env as runtimeEnv } from "../../../lib/env.ts";

/** Typed SDK configuration; execution is denied before these fallbacks can be used. */
export const env = {
  GITHUB_APP_ID: runtimeEnv.GITHUB_APP_ID ?? "",
  GITHUB_APP_PRIVATE_KEY: runtimeEnv.GITHUB_APP_PRIVATE_KEY ?? "",
  GITHUB_APP_INSTALLATION_ID: runtimeEnv.GITHUB_APP_INSTALLATION_ID ?? "",
  GITHUB_ORG: runtimeEnv.GITHUB_ORG ?? "",
};
