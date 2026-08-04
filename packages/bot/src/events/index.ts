/**
 * The event registry.
 *
 * Explicit, for the same reason the command registry is: the legacy app
 * discovered handlers by scanning barrel re-exports, so a forgotten export
 * silently unregistered a behaviour.
 *
 * Not yet here, because they need the agent seam: the mention handler that opens
 * a conversation, the ✅ reaction that ends one, and the feedback reaction that
 * records sentiment against a turn. They arrive with Phase 2.
 */

import type { RedisClient } from "@repo/shared/redis";

import type { AnyEventHandler } from "../framework/events.ts";
import { createCmsClient } from "../integrations/cms.ts";
import { createThreadSlugStore } from "../integrations/hack-night.ts";
import { createShipsClient } from "../integrations/ships.ts";
import { autoThread } from "./auto-thread.ts";
import { emitDashboardMessage } from "./emit-dashboard-message.ts";
import { deleteShipMessage, emitShipMessage } from "./emit-ship-message.ts";
import { hackNightImageRemoval, hackNightImages } from "./hack-night-images.ts";
import { praise } from "./praise.ts";
import { createTranscriber, transcribeVoiceMessage } from "./transcribe-voice-message.ts";

export interface EventDeps {
  readonly redis: RedisClient;
  readonly cmsApiKey: string;
  readonly shipApiKey: string;
  readonly dashboardApiToken: string;
  readonly groqApiKey: string;
}

export function buildEventHandlers(deps: EventDeps): readonly AnyEventHandler[] {
  const cms = createCmsClient({ apiKey: deps.cmsApiKey });
  const slugStore = createThreadSlugStore(deps.redis);
  const ships = createShipsClient({ apiKey: deps.shipApiKey });

  return [
    praise,
    autoThread,
    emitShipMessage(ships),
    deleteShipMessage(ships),
    hackNightImages({ cms, slugStore }),
    hackNightImageRemoval({ cms, slugStore }),
    emitDashboardMessage({ apiToken: deps.dashboardApiToken }),
    transcribeVoiceMessage(createTranscriber({ apiKey: deps.groqApiKey })),
  ];
}
