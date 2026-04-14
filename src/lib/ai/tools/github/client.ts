import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

import { env } from "../../../../env.ts";

export const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
  },
});
