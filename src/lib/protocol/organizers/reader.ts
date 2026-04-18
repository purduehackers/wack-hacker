import { createClient } from "@vercel/edge-config";
import { z } from "zod";

import { env } from "@/env";

import type { OrganizerEntry, OrganizerPlatform, OrganizersMap } from "./types.ts";

import { ORGANIZERS_KEY } from "./constants.ts";

export const organizerSchema = z.object({
  name: z.string(),
  slug: z.string(),
  aliases: z.array(z.string()).optional(),
  linear: z.string().optional(),
  notion: z.string().optional(),
  sentry: z.string().optional(),
  github: z.string().optional(),
  figma: z.string().optional(),
});

export const organizersSchema = z.record(z.string(), organizerSchema);

let client: ReturnType<typeof createClient> | null = null;

function getClient(): ReturnType<typeof createClient> | null {
  if (!env.EDGE_CONFIG) return null;
  client ??= createClient(env.EDGE_CONFIG);
  return client;
}

export async function getOrganizers(): Promise<OrganizersMap> {
  const c = getClient();
  if (!c) return {};
  const raw = await c.get(ORGANIZERS_KEY);
  if (raw === undefined || raw === null) return {};
  const parsed = organizersSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export async function findOrganizer(query: string): Promise<OrganizerEntry | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const organizers = await getOrganizers();

  const byId = organizers[trimmed];
  if (byId) return { ...byId, discord: trimmed };

  for (const [discordId, organizer] of Object.entries(organizers)) {
    if (
      organizer.slug.toLowerCase() === lower ||
      organizer.name.toLowerCase() === lower ||
      organizer.aliases?.some((a) => a.toLowerCase() === lower)
    ) {
      return { ...organizer, discord: discordId };
    }
  }

  return null;
}

export async function resolveOrganizerId(
  query: string,
  platform: OrganizerPlatform,
): Promise<string | null> {
  const organizer = await findOrganizer(query);
  if (!organizer) return null;
  return organizer[platform] ?? null;
}
