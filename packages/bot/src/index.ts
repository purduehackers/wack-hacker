/**
 * Bot entry point.
 *
 * Boot order matters, in both directions.
 *
 * The health server binds *first*, so a supervisor polling `/health` during a
 * slow or failing login gets a structured 503 rather than a refused connection.
 * Readiness stays honest regardless of order, because it derives from the
 * gateway's current WebSocket status rather than from a flag set at startup.
 *
 * Startup then *awaits* login readiness, so a bad token aborts the process
 * instead of leaving a bot that runs and receives nothing. Exiting is
 * deliberate: every host this runs on restarts a failed container with backoff.
 * That is a better outcome than a live process that silently does nothing.
 *
 * Event handlers and schedules attach only *after* readiness, because both need
 * a `Client<true>`. A schedule firing mid-login would also act on a gateway
 * that cannot yet send anything.
 */

import { createConversationStore, type ConversationStore } from "@repo/shared/conversations";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import * as Sentry from "@sentry/bun";
import { Events } from "discord.js";

import { createAgentClient } from "./agent/client.ts";
import { createHitlInteractionHandler } from "./agent/hitl/interaction.ts";
import type { HitlInteractionHandler } from "./agent/hitl/interaction.ts";
import { createDiscordRest } from "./agent/render/discord-rest.ts";
import { createScheduledDiscordAdapter } from "./agent/scheduled.ts";
import { createTurnMessageStore } from "./agent/turn-messages.ts";
import { buildCommands } from "./commands/index.ts";
import { env } from "./env.ts";
import { buildEventHandlers } from "./events/index.ts";
import type { SlashCommand } from "./framework/commands.ts";
import { createDeduplicator } from "./framework/dedup.ts";
import { dispatchInteraction } from "./framework/dispatch.ts";
import { attachEventRouter } from "./framework/events.ts";
import { connect, createClient } from "./framework/gateway.ts";
import { installSignalHandlers, onShutdown, shutdown } from "./framework/lifecycle.ts";
import { consoleReporter } from "./framework/observability.ts";
import { startScheduler } from "./framework/schedules.ts";
import { startServer } from "./framework/server.ts";
import { buildSchedules } from "./schedules/index.ts";
import { createConversationFlow } from "./utils/conversation/index.ts";

function attachInteractionDispatcher(
  client: ReturnType<typeof createClient>,
  commands: readonly SlashCommand[],
  hitl: HitlInteractionHandler,
  redis: RedisClient,
): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void dispatchInteraction(interaction, {
      commands,
      reporter: consoleReporter,
      hitl,
      redis,
    }).catch((cause: unknown) =>
      consoleReporter.captureDefect(cause, { op: "interaction.dispatch" }),
    );
  });
}

function createConversationSeam(
  client: ReturnType<typeof createClient>,
  redis: RedisClient,
  conversations: ConversationStore,
  commands: readonly SlashCommand[],
) {
  const flow = createConversationFlow({
    eve: createAgentClient({
      baseUrl: env.AGENT_URL,
      secret: env.AGENT_INGRESS_SECRET,
    }),
    store: conversations,
    rest: createDiscordRest(client.rest),
    turnMessages: createTurnMessageStore(redis),
    schedules: createScheduledDiscordAdapter({ client }),
    reporter: consoleReporter,
  });
  const hitl = createHitlInteractionHandler({
    flow,
    renders: conversations.renders,
    challenges: conversations.authorizationChallenges,
    reporter: consoleReporter,
    guildId: DISCORD_GUILD_ID,
  });
  attachInteractionDispatcher(client, commands, hitl, redis);
  return flow;
}

function logStartupSummary(input: {
  readonly userTag: string;
  readonly commandCount: number;
  readonly handlerCount: number;
  readonly nextRuns: ReadonlyMap<string, Date | undefined>;
}): void {
  const upcoming = [...input.nextRuns]
    .map(([name, next]) => `${name}=${next?.toISOString() ?? "never"}`)
    .join(" ");
  console.info(`logged in as ${input.userTag}`);
  console.info(
    `${input.commandCount} command(s), ${input.handlerCount} event handler(s), ` +
      `${input.nextRuns.size} schedule(s)${upcoming === "" ? "" : `: ${upcoming}`}`,
  );
}

async function main(): Promise<void> {
  installSignalHandlers();
  // Registered first so reverse-order shutdown flushes Sentry last.
  onShutdown("sentry", async () => {
    await Sentry.close(5_000);
  });

  const client = createClient();

  // These HTTP clients make no connection before the callback server binds.
  const redis = getRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  const built = buildCommands({
    redis,
    vercelToken: env.VERCEL_API_TOKEN,
    dashboardGlobalConfig: env.DASHBOARD_GLOBAL_CONFIG,
  });
  if (Result.isError(built)) {
    console.error(`startup aborted: ${messageOf(built.error)}`);
    process.exit(1);
  }
  const commands = built.value;

  let operationalReady = false;
  const conversations = createConversationStore({ redis });
  const flow = createConversationSeam(client, redis, conversations, commands);

  // Reports ready: false until the gateway connects.
  startServer({
    port: env.PORT,
    client,
    conversations: flow,
    ingressSecret: env.BOT_INGRESS_SECRET,
    operationalReady: () => operationalReady,
  });

  const connected = await connect(client, {
    token: env.DISCORD_BOT_TOKEN,
    onError: (error, context) => consoleReporter.captureDefect(error, context),
  });

  if (Result.isError(connected)) {
    console.error(`startup aborted: ${messageOf(connected.error)}`);
    await shutdown("startup-failure");
    process.exit(1);
  }

  const ready = connected.value;
  // Stop new admissions and drain paint while the gateway still owns its REST token.
  onShutdown("conversation-flow", () => flow.stop());
  const recovered = await Result.tryPromise({
    try: () => flow.start(),
    catch: (cause) => cause,
  });
  if (Result.isError(recovered)) {
    consoleReporter.captureDefect(recovered.error, { op: "agent.router.startup-recovery" });
    await shutdown("startup-recovery-failure");
    process.exit(1);
  }

  const handlers = buildEventHandlers({
    redis,
    agent: flow,
    reporter: consoleReporter,
    cmsApiKey: env.PAYLOAD_CMS_API_KEY,
    shipApiKey: env.SHIP_API_KEY,
    dashboardApiToken: env.PHACK_API_TOKEN,
    groqApiKey: env.GROQ_API_KEY,
  });
  attachEventRouter(ready, {
    handlers,
    reporter: consoleReporter,
    dedup: createDeduplicator(redis),
  });

  const scheduler = startScheduler({
    schedules: buildSchedules({ redis, cmsApiKey: env.PAYLOAD_CMS_API_KEY }),
    client: ready,
    reporter: consoleReporter,
    redis,
  });
  onShutdown("scheduler", () => scheduler.stop());
  operationalReady = true;

  logStartupSummary({
    userTag: ready.user.tag,
    commandCount: commands.length,
    handlerCount: handlers.length,
    nextRuns: scheduler.nextRuns,
  });
}

await main();
