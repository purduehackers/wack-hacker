import { Vercel } from "@vercel/sdk";

import { env } from "@/env";

import type { Organizer, OrganizerPatch, UpsertResult } from "./types.ts";

import { EDITABLE_PLATFORMS, ORGANIZER_KEY_PREFIX } from "./constants.ts";
import { getOrganizer } from "./reader.ts";

/**
 * Atomic per-user upsert. Reads the single `organizer:<discordId>` key, merges
 * the patch, writes just that key back. Concurrent writes for *different* users
 * never collide; same-user concurrent writes remain a theoretical last-writer-wins
 * race but are negligible in practice (one person submitting the modal twice).
 */
export async function upsertOrganizer(
  discordId: string,
  patch: OrganizerPatch,
): Promise<UpsertResult> {
  const existing = await getOrganizer(discordId);

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
    } else if (patchVal === "") {
      if (existingVal !== undefined) cleared.push(platform);
    } else {
      next[platform] = patchVal;
      if (existingVal !== patchVal) set.push(platform);
    }
  }

  const vercel = new Vercel({ bearerToken: env.VERCEL_API_TOKEN });
  await vercel.edgeConfig.patchEdgeConfigItems({
    edgeConfigId: env.VERCEL_EDGE_CONFIG_ID,
    requestBody: {
      items: [{ operation: "upsert", key: `${ORGANIZER_KEY_PREFIX}${discordId}`, value: next }],
    },
  });

  return { organizer: next, set, cleared };
}
