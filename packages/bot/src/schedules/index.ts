/**
 * The schedule registry.
 *
 * Explicit, like the command and event registries. The caller passes
 * dependencies in because two of the three jobs need the slug store and the
 * CMS client. A job reaching for a module-level singleton would be untraceable
 * at startup.
 */

import type { RedisClient } from "@repo/shared/redis";

import type { Schedule } from "../framework/schedules.ts";
import { createCmsClient } from "../integrations/cms.ts";
import { createThreadSlugStore } from "../integrations/hack-night.ts";
import { hackNightCleanup } from "./hack-night-cleanup.ts";
import { hackNightCountdown } from "./hack-night-countdown.ts";
import { hackNightPhotographyThread } from "./hack-night-photography-thread.ts";

export interface ScheduleDeps {
  readonly redis: RedisClient;
  readonly cmsApiKey: string;
}

/**
 * Builds every schedule with its dependencies wired explicitly, so startup
 * shows exactly which job talks to Redis or the CMS.
 */
export function buildSchedules(deps: ScheduleDeps): readonly Schedule[] {
  const slugStore = createThreadSlugStore(deps.redis);
  const cms = createCmsClient({ apiKey: deps.cmsApiKey });

  return [
    hackNightCountdown(),
    hackNightPhotographyThread({ slugStore }),
    hackNightCleanup({ slugStore, cms }),
  ];
}
