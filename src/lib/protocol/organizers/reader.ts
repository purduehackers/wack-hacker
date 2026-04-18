import { createClient } from "@vercel/edge-config";
import { z } from "zod";

import { env } from "@/env";

import type { Organizer, OrganizerEntry, OrganizerPlatform, OrganizersMap } from "./types.ts";

import { ORGANIZER_KEY_PREFIX } from "./constants.ts";

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

function getClient(): ReturnType<typeof createClient> {
  client ??= createClient(env.EDGE_CONFIG);
  return client;
}

/** Read every `organizer:*` key and build a Discord-ID → Organizer map. */
export async function getOrganizers(): Promise<OrganizersMap> {
  const all = (await getClient().getAll()) ?? {};
  const result: OrganizersMap = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(ORGANIZER_KEY_PREFIX)) continue;
    const parsed = organizerSchema.safeParse(value);
    if (parsed.success) result[key.slice(ORGANIZER_KEY_PREFIX.length)] = parsed.data;
  }
  return result;
}

/** Read a single organizer by Discord ID — used by the writer for read-modify-write. */
export async function getOrganizer(discordId: string): Promise<Organizer | null> {
  const raw = await getClient().get(`${ORGANIZER_KEY_PREFIX}${discordId}`);
  if (raw === undefined || raw === null) return null;
  const parsed = organizerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
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
