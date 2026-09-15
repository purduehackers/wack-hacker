import { parseArgs } from "node:util";

import { InvalidInput, Transient } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { z } from "zod";

import {
  createInstagramCredentials,
  instagramConfig,
} from "../src/integrations/socials/credentials.ts";
import { enrichSocialPost, socialEmbed } from "../src/integrations/socials/embeds.ts";
import { createSocialSources, socialError } from "../src/integrations/socials/index.ts";
import { baselineSocialSource } from "../src/integrations/socials/poll.ts";
import { createSocialStore, SOCIALS_NAMESPACE } from "../src/integrations/socials/store.ts";
import type { SocialStore } from "../src/integrations/socials/store.ts";
import { socialPlatformSchema } from "../src/integrations/socials/types.ts";
import type { SocialSource } from "../src/integrations/socials/types.ts";

async function inspectSource(source: SocialSource) {
  const entries = [...(await source.read(new Date()))].sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
  const latest = entries[0];
  const embed =
    latest === undefined ? undefined : socialEmbed(source, await enrichSocialPost(source, latest));
  console.info(
    JSON.stringify({
      source: source.id,
      account: source.account,
      available: entries.length,
      latest: latest?.url,
      hasImage: embed?.image !== undefined,
    }),
  );
  return { source: source.id, embed };
}

async function baseline(source: SocialSource, store: SocialStore): Promise<void> {
  const acquired = await store.run(source, async (lease) => {
    const created = await baselineSocialSource(source, lease);
    console.info(
      `${source.id}: ${created ? "baseline saved; no announcements queued" : "existing baseline preserved"}`,
    );
  });
  if (!acquired)
    throw new Transient({ operation: `${source.id} baseline`, detail: "source is busy; retry" });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      baseline: { type: "boolean", default: false },
      "replace-instagram-token": { type: "boolean", default: false },
      source: { type: "string" },
      preview: { type: "string" },
    },
    strict: true,
  });
  const selected = socialPlatformSchema.optional().safeParse(values.source);
  if (!selected.success)
    throw new InvalidInput({ subject: "source", issues: ["expected youtube, blog, or instagram"] });
  if (values.baseline && values.preview !== undefined)
    throw new InvalidInput({
      subject: "source check",
      issues: ["run --baseline and --preview separately"],
    });
  const config =
    selected.data === undefined ||
    selected.data === "instagram" ||
    values["replace-instagram-token"]
      ? instagramConfig(process.env["INSTAGRAM_USER_ID"], process.env["INSTAGRAM_ACCESS_TOKEN"])
      : undefined;
  const storage = z
    .object({ UPSTASH_REDIS_REST_URL: z.url(), UPSTASH_REDIS_REST_TOKEN: z.string().min(1) })
    .safeParse(process.env);
  const redis = storage.success
    ? getRedis({
        url: storage.data.UPSTASH_REDIS_REST_URL,
        token: storage.data.UPSTASH_REDIS_REST_TOKEN,
      })
    : undefined;
  if ((values.baseline || values["replace-instagram-token"]) && redis === undefined)
    throw new InvalidInput({
      subject: "socials storage",
      issues: ["set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN"],
    });
  const store = redis === undefined ? undefined : createSocialStore(redis, SOCIALS_NAMESPACE);
  const credentials =
    redis !== undefined && config !== undefined
      ? createInstagramCredentials({
          redis,
          namespace: SOCIALS_NAMESPACE,
          accountId: config.accountId,
          bootstrapToken: config.token,
        })
      : undefined;
  if (values["replace-instagram-token"]) {
    await credentials?.replace();
    console.info("Instagram: verified @purduehackers and replaced the stored token");
  }
  const adapters = createSocialSources(
    config === undefined
      ? undefined
      : {
          accountId: config.accountId,
          token: credentials?.current ?? (async () => config.token),
        },
  ).filter((source) => selected.data === undefined || source.id === selected.data);
  const previews = [];
  for (const source of adapters) {
    try {
      if (values.baseline && store !== undefined) {
        await baseline(source, store);
      } else {
        previews.push(await inspectSource(source));
      }
    } catch (cause) {
      console.error(`${source.id}: ${socialError(cause).message}`);
      process.exitCode = 1;
    }
  }
  if (values.baseline) await credentials?.refresh();
  if (values.preview !== undefined) {
    await Bun.write(values.preview, `${JSON.stringify(previews, undefined, 2)}\n`);
    console.info(`Embed previews saved to ${values.preview}`);
  }
}

await main().catch((cause: unknown) => {
  console.error(socialError(cause).message);
  process.exitCode = 1;
});
