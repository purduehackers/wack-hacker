import { createBadgeService, createBadgeStore, createWorker } from "@repo/badges";
import type { BadgeStore } from "@repo/badges";
import { getDb } from "@repo/shared/db";

import { tursoConfig } from "../../../agents/agent/env.ts";
import { cms } from "./cms.ts";
import { createPublisher } from "./publisher.ts";

let repository: BadgeStore | undefined;

/** Eve evaluates tool definitions at build time; only executions may open storage. */
export function runtime() {
  const store = (repository ??= createBadgeStore(getDb(tursoConfig())));
  return {
    store,
    service: createBadgeService(store, cms),
    worker: createWorker(store, cms, createPublisher(store)),
  };
}
