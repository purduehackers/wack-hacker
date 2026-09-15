/**
 * The schedule registry.
 *
 * Explicit, like the command and event registries. Dependencies are passed in
 * because jobs need the drop store and the CMS client, and a job
 * reaching for a module-level singleton would be untraceable at startup.
 */

import type { RedisClient } from "@repo/shared/redis";

import type { Schedule } from "../framework/schedules.ts";
import { createCmsClient } from "../integrations/cms.ts";
import { createImageDropStore } from "../integrations/image-drop.ts";
import type { InstagramConfig } from "../integrations/socials/credentials.ts";
import { hackNightCleanup } from "./hack-night-cleanup.ts";
import { hackNightCountdown } from "./hack-night-countdown.ts";
import { hackNightPhotographyThread } from "./hack-night-photography-thread.ts";
import { socialsSchedules } from "./socials.ts";
import { websiteEventSync } from "./website-event-sync.ts";

export interface ScheduleDeps {
  readonly redis: RedisClient;
  readonly cmsApiKey: string;
  readonly socials: InstagramConfig | undefined;
}

export function buildSchedules(deps: ScheduleDeps): readonly Schedule[] {
  const drops = createImageDropStore(deps.redis);
  const cms = createCmsClient({ apiKey: deps.cmsApiKey });

  return [
    websiteEventSync({ cms }),
    hackNightCountdown(),
    hackNightPhotographyThread({ drops }),
    hackNightCleanup({ drops, cms }),
    ...(deps.socials === undefined ? [] : socialsSchedules(deps.redis, deps.socials)),
  ];
}
