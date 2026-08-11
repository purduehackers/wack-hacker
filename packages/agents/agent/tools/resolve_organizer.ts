import { UpstreamError } from "@repo/shared/errors";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "../env.ts";
import { readGlobalConfigItems } from "../lib/global-config.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/policy/core-tools.ts";
import { guardToolExecution } from "../lib/serialization.ts";

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
  if (env.GLOBAL_CONFIG === undefined) {
    throw new UpstreamError({
      service: "Global Config",
      status: 503,
      detail: "organizer roster is not configured",
    });
  }

  const items = await readGlobalConfigItems(env.GLOBAL_CONFIG);
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

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("resolve_organizer", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Resolve a Purdue Hackers organizer by name or alias to their authoritative platform user IDs (Discord, Linear, Notion, Sentry, GitHub, Figma). Call this before any platform-specific user search whenever the user refers to someone by name. Returns found:false if no organizer matches.",
        inputSchema: resolveOrganizerInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("resolve_organizer", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await resolveOrganizer(input);
            } catch (cause) {
              return coreToolFailure("Global Config", cause);
            }
          });
        },
      });
    },
  },
});
