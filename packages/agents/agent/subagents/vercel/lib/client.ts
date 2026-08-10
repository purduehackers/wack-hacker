import { Vercel } from "@vercel/sdk";

import { env } from "./constants.ts";

let client: Vercel | undefined;

/**
 * Lazy Vercel SDK client, instantiated on first access. Every caller should
 * inject `teamId` / `slug` from `./constants.ts` rather than passing the
 * client directly to calls that expect a team context.
 */
export function vercel(): Vercel {
  if (!client) client = new Vercel({ bearerToken: env.VERCEL_API_TOKEN });
  return client;
}
