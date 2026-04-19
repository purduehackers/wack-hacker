import { tool } from "ai";
import { z } from "zod";

import { findOrganizer } from "@/lib/protocol/organizers";

const PLATFORMS = ["discord", "linear", "notion", "sentry", "github", "figma"] as const;

export const resolve_organizer = tool({
  description:
    "Resolve a Purdue Hackers organizer by name or alias to their authoritative platform user IDs (Discord, Linear, Notion, Sentry, GitHub, Figma). Call this before any platform-specific user search whenever the user refers to someone by name (e.g. 'assign to ray'). Returns found:false if no organizer matches.",
  inputSchema: z.object({
    name: z.string().describe("Organizer's name, handle, alias, or Discord user ID"),
    platform: z
      .enum(PLATFORMS)
      .optional()
      .describe("If set, returns just that platform's ID; otherwise returns all known IDs."),
  }),
  execute: async ({ name, platform }) => {
    const organizer = await findOrganizer(name);
    if (!organizer) return JSON.stringify({ found: false });

    if (platform) {
      const id = organizer[platform] ?? null;
      return JSON.stringify({ found: true, name: organizer.name, platform, id });
    }

    return JSON.stringify({
      found: true,
      name: organizer.name,
      slug: organizer.slug,
      aliases: organizer.aliases,
      discord: organizer.discord,
      linear: organizer.linear,
      notion: organizer.notion,
      sentry: organizer.sentry,
      github: organizer.github,
      figma: organizer.figma,
    });
  },
});
