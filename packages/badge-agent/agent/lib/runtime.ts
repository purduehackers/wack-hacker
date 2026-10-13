import { tursoConfig } from "@repo/agents/env";
import { renderBadge } from "@repo/badge-renderer";
import { createBadgeService, createBadgeStore, createWorker } from "@repo/badges";
import type { BadgeStore } from "@repo/badges";
import { createBadgeInventory } from "@repo/badges/inventory";
import { stockMaterial } from "@repo/badges/materials";
import { getDb } from "@repo/shared/db";

import { cms } from "./cms.ts";
import { createPublisher } from "./publisher.ts";

let repository: BadgeStore | undefined;

// A visual example, not a stock assignment or a physical laser simulation.
const previewMaterial = stockMaterial("transparent-light-blue");
async function renderPreview(svg: string) {
  if (!previewMaterial) throw new Error("Missing preview material.");
  return {
    image: await renderBadge({ svg, material: previewMaterial, thicknessMm: 3.175 }),
    material: "Light blue acrylic · ⅛ in",
  };
}

/** Eve evaluates tool definitions at build time; only executions may open storage. */
export function runtime() {
  const store = (repository ??= createBadgeStore(getDb(tursoConfig())));
  return {
    store,
    inventory: createBadgeInventory(getDb(tursoConfig())),
    service: createBadgeService(store, cms),
    worker: createWorker(store, cms, createPublisher(store), renderPreview),
  };
}
