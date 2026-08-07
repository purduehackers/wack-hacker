import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

import { env } from "./config.ts";

let client: Octokit | undefined;

/** Lazy SDK client so missing optional configuration cannot break discovery. */
export function octokit(): Octokit {
  client ??= new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
    },
  });
  return client;
}
