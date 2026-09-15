import { DISCORD_IDS } from "@repo/shared/discord";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import type { Schedule } from "../framework/schedules.ts";
import { createInstagramCredentials } from "../integrations/socials/credentials.ts";
import type { InstagramConfig } from "../integrations/socials/credentials.ts";
import {
  createSocialDelivery,
  deliverSocialPosts,
  verifySocialsAccess,
} from "../integrations/socials/deliver.ts";
import { createSocialSources, socialError } from "../integrations/socials/index.ts";
import { pollSocialSource } from "../integrations/socials/poll.ts";
import { createSocialStore, SOCIALS_NAMESPACE } from "../integrations/socials/store.ts";

export function socialsSchedules(redis: RedisClient, config: InstagramConfig): readonly Schedule[] {
  const credentials = createInstagramCredentials({
    redis,
    namespace: SOCIALS_NAMESPACE,
    accountId: config.accountId,
    bootstrapToken: config.token,
  });
  const adapters = createSocialSources({ accountId: config.accountId, token: credentials.current });
  const store = createSocialStore(redis, SOCIALS_NAMESPACE);
  return [
    ...adapters.flatMap((source): Schedule[] => [
      {
        name: `socials-poll-${source.id}`,
        cron: "*/5 * * * *",
        run: async () =>
          Result.tryPromise({
            try: async () => {
              await store.run(source, (lease) => pollSocialSource(source, lease));
            },
            catch: socialError,
          }),
      },
      {
        name: `socials-deliver-${source.id}`,
        // Leases serialize a concurrent poll; queues drain during source outages.
        cron: "* * * * *",
        run: async ({ client }) =>
          Result.tryPromise({
            try: async () => {
              await store.run(source, async (lease) => {
                const delivery = createSocialDelivery(
                  client,
                  DISCORD_IDS.channels.SOCIALS,
                  async () => {
                    await verifySocialsAccess(client, DISCORD_IDS.channels.SOCIALS);
                    await lease.renew();
                  },
                );
                await deliverSocialPosts(source, lease, delivery);
              });
            },
            catch: socialError,
          }),
      },
    ]),
    {
      name: "socials-instagram-refresh",
      cron: "15 9 * * *",
      run: async () => Result.tryPromise({ try: credentials.refresh, catch: socialError }),
    },
  ];
}
