import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../env.ts";
import { readEdgeConfigItems } from "./edge-config.ts";

const ORGANIZER_KEY_PREFIX = "organizer_";

const organizerPlatformSchema = z.enum([
  "discord",
  "linear",
  "notion",
  "sentry",
  "github",
  "figma",
]);

const organizerSchema = z.strictObject({
  name: z.string(),
  slug: z.string(),
  aliases: z.array(z.string()).optional(),
  linear: z.string().optional(),
  notion: z.string().optional(),
  sentry: z.string().optional(),
  github: z.string().optional(),
  figma: z.string().optional(),
});

export const resolveOrganizerInputSchema = z.strictObject({
  name: z.string().describe("Organizer's name, handle, alias, or Discord user ID"),
  platform: organizerPlatformSchema
    .optional()
    .describe("If set, returns just that platform's ID; otherwise returns all known IDs."),
});

async function findOrganizer(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  if (env.EDGE_CONFIG === undefined) {
    throw new UpstreamError({
      service: "Edge Config",
      status: 503,
      detail: "organizer roster is not configured",
    });
  }

  const items = await readEdgeConfigItems(env.EDGE_CONFIG);
  const organizerEntries = Object.entries(items).flatMap(([key, value]) => {
    if (!key.startsWith(ORGANIZER_KEY_PREFIX)) return [];
    const parsed = organizerSchema.safeParse(value);
    return parsed.success
      ? [{ discord: key.slice(ORGANIZER_KEY_PREFIX.length), ...parsed.data }]
      : [];
  });

  const byDiscordId = organizerEntries.find((entry) => entry.discord === trimmed);
  if (byDiscordId !== undefined) return byDiscordId;

  const lower = trimmed.toLowerCase();
  return organizerEntries.find(
    (entry) =>
      entry.slug.toLowerCase() === lower ||
      entry.name.toLowerCase() === lower ||
      Boolean(entry.aliases?.some((alias) => alias.toLowerCase() === lower)),
  );
}

export async function resolveOrganizer(input: z.output<typeof resolveOrganizerInputSchema>) {
  const organizer = await findOrganizer(input.name);
  if (organizer === undefined) return { found: false } as const;

  if (input.platform !== undefined) {
    return {
      found: true,
      name: organizer.name,
      platform: input.platform,
      // oxlint-disable-next-line unicorn/no-null -- legacy API uses null for a known organizer without this platform ID
      id: organizer[input.platform] ?? null,
    } as const;
  }

  return {
    found: true,
    name: organizer.name,
    slug: organizer.slug,
    ...(organizer.aliases === undefined ? {} : { aliases: organizer.aliases }),
    discord: organizer.discord,
    ...(organizer.linear === undefined ? {} : { linear: organizer.linear }),
    ...(organizer.notion === undefined ? {} : { notion: organizer.notion }),
    ...(organizer.sentry === undefined ? {} : { sentry: organizer.sentry }),
    ...(organizer.github === undefined ? {} : { github: organizer.github }),
    ...(organizer.figma === undefined ? {} : { figma: organizer.figma }),
  } as const;
}
