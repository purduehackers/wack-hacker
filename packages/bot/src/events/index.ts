/**
 * The event registry.
 *
 * Explicit, for the same reason the command registry is: the prior implementation
 * discovered handlers by scanning barrel re-exports, so a forgotten export
 * silently unregistered a behaviour.
 *
 * Order within the list does not matter — the router buckets handlers by kind
 * and runs each bucket concurrently — except that `kind: "mention"` handlers
 * always complete before `kind: "message"` ones, which is how `agent-chat`
 * claims a message before the community handlers see it.
 */

import type { RedisClient } from "@repo/shared/redis";
import type { Reporter } from "@repo/shared/result/observe";

import { createTurnMessageStore } from "../agent/turn-messages.ts";
import type { AnyEventHandler } from "../framework/events.ts";
import { createCmsClient } from "../integrations/cms.ts";
import { createThreadSlugStore } from "../integrations/hack-night.ts";
import { createShipsClient } from "../integrations/ships.ts";
import type { ConversationFlow } from "../utils/conversation/index.ts";
import { agentChat, conversationDone } from "./agent-chat.ts";
import { autoThread } from "./auto-thread.ts";
import { chatFeedback } from "./chat-indexer.ts";
import { emitDashboardMessage } from "./emit-dashboard-message.ts";
import { deleteShipMessage, emitShipMessage } from "./emit-ship-message.ts";
import { hackNightImageRemoval, hackNightImages } from "./hack-night-images.ts";
import { praise } from "./praise.ts";
import { createTranscriber, transcribeVoiceMessage } from "./transcribe-voice-message.ts";

export interface EventDeps {
  readonly redis: RedisClient;
  readonly agent: ConversationFlow;
  readonly reporter: Reporter;
  readonly cmsApiKey: string;
  readonly shipApiKey: string;
  readonly dashboardApiToken: string;
  readonly groqApiKey: string;
}

export function buildEventHandlers(deps: EventDeps): readonly AnyEventHandler[] {
  const cms = createCmsClient({ apiKey: deps.cmsApiKey });
  const slugStore = createThreadSlugStore(deps.redis);
  const ships = createShipsClient({ apiKey: deps.shipApiKey });
  const turnMessages = createTurnMessageStore(deps.redis);

  return [
    agentChat({ agent: deps.agent }),
    conversationDone({ agent: deps.agent, turnMessages }),
    chatFeedback({ turnMessages, reporter: deps.reporter }),
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
