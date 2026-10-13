import { tursoConfig } from "@repo/agents/env";
import { renderBadge } from "@repo/badge-renderer";
import { createBadgeService, createBadgeStore, createWorker } from "@repo/badges";
import type { BadgeMaterial, BadgeStore } from "@repo/badges";
import { createBadgeInventory } from "@repo/badges/inventory";
import { stockMaterial } from "@repo/badges/materials";
import { getDb } from "@repo/shared/db";

import { cms } from "./cms.ts";
import { createPublisher } from "./publisher.ts";

let repository: BadgeStore | undefined;

async function renderPreview(svg: string, selection: BadgeMaterial) {
  const material = stockMaterial(selection.materialId);
  if (!material || material.id === "stamp-rubber") throw new Error("Choose an acrylic material.");
  return renderBadge({ svg, material, thicknessMm: selection.thicknessMm });
}

/** Eve evaluates tool definitions at build time; only executions may open storage. */
export function runtime() {
  const store = (repository ??= createBadgeStore(getDb(tursoConfig())));
  const inventory = createBadgeInventory(getDb(tursoConfig()));
  return {
    store,
    inventory,
    service: createBadgeService(store, cms, inventory),
    worker: createWorker(store, cms, createPublisher(store), renderPreview, inventory),
  };
}
