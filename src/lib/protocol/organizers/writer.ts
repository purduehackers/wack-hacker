import { Vercel } from "@vercel/sdk";

import { env } from "@/env";

import type { Organizer, OrganizerPatch, OrganizersMap, UpsertResult } from "./types.ts";

import { EDITABLE_PLATFORMS, ORGANIZERS_KEY } from "./constants.ts";
import { getOrganizers } from "./reader.ts";

export async function upsertOrganizer(
  discordId: string,
  patch: OrganizerPatch,
): Promise<UpsertResult> {
  const current = await getOrganizers();
  const existing = current[discordId];

  const next: Organizer = {
    name: patch.name ?? existing?.name ?? discordId,
    slug: (patch.slug ?? existing?.slug ?? discordId).toLowerCase(),
    aliases: patch.aliases ?? existing?.aliases,
  };

  const set: UpsertResult["set"] = [];
  const cleared: UpsertResult["cleared"] = [];

  for (const platform of EDITABLE_PLATFORMS) {
    const patchVal = patch[platform];
    const existingVal = existing?.[platform];
    if (patchVal === undefined) {
      if (existingVal !== undefined) next[platform] = existingVal;
      continue;
    }
    if (patchVal === "") {
      if (existingVal !== undefined) cleared.push(platform);
      continue;
    }
    next[platform] = patchVal;
    if (existingVal !== patchVal) set.push(platform);
  }

  const merged: OrganizersMap = { ...current, [discordId]: next };

  const vercel = new Vercel({ bearerToken: env.VERCEL_API_TOKEN });
  await vercel.edgeConfig.patchEdgeConfigItems({
    edgeConfigId: env.VERCEL_EDGE_CONFIG_ID,
    requestBody: {
      items: [{ operation: "upsert", key: ORGANIZERS_KEY, value: merged }],
    },
  });

  return { organizer: next, set, cleared };
}
