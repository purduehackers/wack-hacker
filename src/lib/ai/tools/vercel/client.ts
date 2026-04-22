import { Vercel } from "@vercel/sdk";

import { env } from "../../../../env.ts";
import { VERCEL_TEAM_SLUG } from "./constants.ts";

let client: Vercel | undefined;

/**
 * Lazy Vercel SDK client. Instantiated on first access so tests can mock the
 * module before it loads. Every caller should inject `teamId` / `slug` via
 * the helpers below rather than passing the client directly to calls that
 * expect a team context.
 */
export function vercel(): Vercel {
  if (!client) client = new Vercel({ bearerToken: env.VERCEL_API_TOKEN });
  return client;
}

/** Build a dashboard URL for a project by id or name. */
export function projectUrl(projectIdOrName: string): string {
  return `https://vercel.com/${VERCEL_TEAM_SLUG}/${encodeURIComponent(projectIdOrName)}`;
}

/** Build a dashboard URL for a specific deployment. */
export function deploymentUrl(projectIdOrName: string, deploymentId: string): string {
  return `${projectUrl(projectIdOrName)}/${encodeURIComponent(deploymentId)}`;
}
