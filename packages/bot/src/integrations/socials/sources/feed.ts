import { InvalidInput } from "@repo/shared/errors";
import Parser from "rss-parser";
import { z } from "zod";

import { socialRequest } from "../http.ts";
import { socialPostSchema } from "../types.ts";
import type { SocialFetch, SocialPost, SocialSource } from "../types.ts";

interface FeedFields {
  readonly id?: string;
}
interface ItemFields {
  readonly media?: unknown;
}
const mediaSchema = z.object({
  "media:description": z.array(z.string()).optional(),
  "media:thumbnail": z.array(z.object({ $: z.object({ url: z.url() }) })).optional(),
});

interface FeedSourceOptions {
  readonly id: "blog" | "youtube";
  readonly name: string;
  readonly account: string;
  readonly profileUrl: string;
  readonly feedUrl: string;
}

function normalizeItem(item: Parser.Item & ItemFields, source: FeedSourceOptions): SocialPost {
  const url = URL.parse(item.link ?? "");
  const allowedHost = source.id === "youtube" ? "www.youtube.com" : "blog.purduehackers.com";
  const published = Date.parse(item.isoDate ?? item.pubDate ?? "");
  if (url?.protocol !== "https:" || url.hostname !== allowedHost || !Number.isFinite(published)) {
    throw new InvalidInput({
      subject: `${source.id} item`,
      issues: ["missing canonical URL or date"],
    });
  }
  const id = source.id === "youtube" ? url.searchParams.get("v") : (item.guid ?? url.href);
  if (!id) throw new InvalidInput({ subject: `${source.id} item`, issues: ["missing stable ID"] });
  const media = mediaSchema.safeParse(item.media);
  const imageUrl = media.success
    ? media.data["media:thumbnail"]?.[0]?.$.url
    : item.enclosure?.type?.startsWith("image/")
      ? item.enclosure.url
      : undefined;
  return socialPostSchema.parse({
    id,
    url: url.href,
    title: item.title ?? `New ${source.name} post`,
    text: media.success
      ? (media.data["media:description"]?.[0] ?? item.contentSnippet ?? "")
      : (item.contentSnippet ?? item.summary ?? ""),
    publishedAt: new Date(published).toISOString(),
    imageUrl,
  });
}

/** One maintained RSS/Atom parser for both feeds, with a bounded native transport. */
function createFeedSource(options: FeedSourceOptions, request?: SocialFetch): SocialSource {
  const parser = new Parser<FeedFields, ItemFields>({
    customFields: { feed: ["id"], item: [["media:group", "media"]] },
  });
  return {
    id: options.id,
    account: options.account,
    name: options.name,
    profileUrl: options.profileUrl,
    history: "window",
    read: async (_since) => {
      const xml = await socialRequest(options.id, new URL(options.feedUrl), request);
      let feed: FeedFields & Parser.Output<ItemFields>;
      try {
        feed = await parser.parseString(xml);
      } catch {
        throw new InvalidInput({ subject: `${options.id} feed`, issues: ["invalid RSS/Atom"] });
      }
      // YouTube's Atom IDs currently omit the channel ID's leading "UC".
      const channelIds = new Set([
        `yt:channel:${options.account}`,
        `yt:channel:${options.account.slice(2)}`,
      ]);
      if (options.id === "youtube" && !channelIds.has(feed.id ?? "")) {
        throw new InvalidInput({
          subject: "YouTube feed",
          issues: ["unexpected channel identity"],
        });
      }
      if (feed.items.length === 0) {
        throw new InvalidInput({
          subject: `${options.id} feed`,
          issues: ["unexpected empty feed"],
        });
      }
      return feed.items.map((item) => normalizeItem(item, options));
    },
  };
}

export function createBlogSource(request?: SocialFetch): SocialSource {
  return createFeedSource(
    {
      id: "blog",
      name: "Blog",
      account: "blog.purduehackers.com",
      profileUrl: "https://blog.purduehackers.com/",
      feedUrl: "https://blog.purduehackers.com/rss.xml",
    },
    request,
  );
}

export function createYouTubeSource(request?: SocialFetch): SocialSource {
  const account = "UCaiaDVdWSIhv0sIzdiA0l2w";
  return createFeedSource(
    {
      id: "youtube",
      name: "YouTube",
      account,
      profileUrl: "https://www.youtube.com/@PurdueHackers",
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${account}`,
    },
    request,
  );
}
