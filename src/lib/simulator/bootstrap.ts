import { ConversationStore } from "@/bot/store";
import { TurnMessageStore } from "@/bot/turn-message-store";
import { ApprovalStore } from "@/lib/ai/approvals/store";
import { __setDiscordRestForSimulation } from "@/lib/ai/tools/discord/client";
import { DISCORD_IDS } from "@/lib/protocol/constants";
import { __setRedisForSimulation } from "@/lib/redis/client";
import { createMemoryRedis } from "@/lib/redis/fakes";

import { SIM_BOT_ID, SIM_DEFAULT_CHANNEL, SIM_GUILD_ID } from "./constants.ts";
import { SimConversation } from "./conversation.ts";
import { SimEventBus } from "./event-bus.ts";
import { createFakeCoreAPI } from "./fake-core-api.ts";
import { createFakeRest } from "./fake-rest.ts";
import { assertSimEnabled } from "./guard.ts";
import { VirtualGuild } from "./virtual-guild.ts";

/**
 * Wire a fresh simulator session: build the virtual guild + event bus, install
 * the process-global fakes (memory Redis, virtual Discord REST), and construct
 * the conversation over them. Gated — refuses to run outside a dev simulator
 * process. The Redis/REST swaps are global, so a process serves one active
 * session at a time (see {@link getOrCreateSession}).
 */
export function bootstrapSimulator(sessionId: string): SimConversation {
  assertSimEnabled();

  const guild = new VirtualGuild({
    guildId: SIM_GUILD_ID,
    botUserId: SIM_BOT_ID,
    channels: [{ name: SIM_DEFAULT_CHANNEL }],
    members: [
      { id: SIM_BOT_ID, username: "wack-hacker", displayName: "Wack Hacker", bot: true, roles: [] },
    ],
    roles: [
      { id: DISCORD_IDS.roles.ORGANIZER, name: "organizer", color: "#5865f2" },
      { id: DISCORD_IDS.roles.ADMIN, name: "admin", color: "#eb459e" },
    ],
  });
  const bus = new SimEventBus(sessionId);

  // Install globals BEFORE constructing the stores so they resolve to the
  // memory Redis (the approval wrapper also builds `new ApprovalStore()`
  // internally — it must hit this same instance).
  const redis = createMemoryRedis();
  __setRedisForSimulation(redis);
  __setDiscordRestForSimulation(createFakeRest(guild, bus));

  return new SimConversation({
    id: sessionId,
    guild,
    bus,
    coreApi: createFakeCoreAPI(guild, bus),
    store: new ConversationStore(),
    approvalStore: new ApprovalStore(),
    turnMessageStore: new TurnMessageStore(),
  });
}
