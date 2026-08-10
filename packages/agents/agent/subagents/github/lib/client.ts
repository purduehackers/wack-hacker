import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import { z } from "zod";

import { env } from "./constants.ts";

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

/** Octokit rejects a failed request with an error object carrying the HTTP status. */
const octokitErrorSchema = z.looseObject({ status: z.int() });

/** The HTTP status of a thrown Octokit error, or undefined when it is not one. */
export function octokitStatus(error: unknown): number | undefined {
  return octokitErrorSchema.safeParse(error).data?.status;
}
