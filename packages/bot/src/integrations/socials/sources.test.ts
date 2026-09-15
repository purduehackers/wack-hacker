import { expect, test } from "bun:test";

import { InvalidInput, RateLimited, RecoveryRequired } from "@repo/shared/errors";

import { enrichSocialPost, socialEmbed } from "./embeds.ts";
import { createBlogSource, createYouTubeSource } from "./sources/feed.ts";
import { createInstagramClient, createInstagramSource } from "./sources/instagram.ts";
import type { SocialFetch, SocialPost } from "./types.ts";

const youtubeXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <id>yt:channel:aiaDVdWSIhv0sIzdiA0l2w</id><title>Purdue Hackers</title>
  <entry><id>yt:video:video-1</id><title>Demo &amp; discussion</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=video-1"/>
    <published>2026-09-15T01:00:00+00:00</published>
    <media:group><media:description>A project demo</media:description><media:thumbnail url="https://i.ytimg.com/vi/video-1/hqdefault.jpg"/></media:group>
  </entry>
</feed>`;

test("YouTube uses the shared Atom parser and preserves media previews", async () => {
  const source = createYouTubeSource(async () => new Response(youtubeXml));
  expect(await source.read(new Date())).toEqual([
    {
      id: "video-1",
      title: "Demo & discussion",
      text: "A project demo",
      url: "https://www.youtube.com/watch?v=video-1",
      publishedAt: "2026-09-15T01:00:00.000Z",
      imageUrl: "https://i.ytimg.com/vi/video-1/hqdefault.jpg",
    },
  ]);
});

test("a different YouTube channel cannot enter the queue", async () => {
  const source = createYouTubeSource(
    async () => new Response(youtubeXml.replace("aiaDVdWSIhv0sIzdiA0l2w", "someone-else")),
  );
  expect(await source.read(new Date()).catch((cause: unknown) => cause)).toBeInstanceOf(
    InvalidInput,
  );
});

test("blog RSS uses stable GUIDs and decoded plain-text excerpts", async () => {
  const xml = `<rss version="2.0"><channel><title>Purdue Hackers</title><link>https://blog.purduehackers.com/</link><description>Blog</description><item><guid>article-1</guid><title>A project</title><link>https://blog.purduehackers.com/posts/project/</link><description><![CDATA[<p>Build &amp; share.</p>]]></description><pubDate>Tue, 15 Sep 2026 01:00:00 GMT</pubDate></item></channel></rss>`;
  const entries = await createBlogSource(async () => new Response(xml)).read(new Date());
  expect(entries[0]).toMatchObject({
    id: "article-1",
    text: "Build & share.",
    publishedAt: "2026-09-15T01:00:00.000Z",
  });
});

const accountId = "17841408764682550";
const media = (id: string, timestamp: string) => ({
  id,
  timestamp,
  permalink: `https://www.instagram.com/p/${id}/`,
  media_type: "IMAGE",
  caption: "Caption",
  media_url: "https://cdn.example.com/image.jpg",
});
function instagramMock(pages: readonly unknown[], username = "purduehackers") {
  const calls: URL[] = [];
  let index = 0;
  const request: SocialFetch = async (url, init) => {
    calls.push(url);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
    if (url.pathname.endsWith("/me")) return Response.json({ user_id: accountId, username });
    const response = pages[index++];
    if (response === undefined)
      throw new InvalidInput({ subject: "test", issues: ["unexpected request"] });
    return Response.json(response);
  };
  return { calls, options: { accountId, token: async () => "test-token", request } };
}

test("Instagram validates identity, normalizes Meta timestamps, and paginates to the boundary", async () => {
  const stub = instagramMock([
    {
      data: [media("new", "2026-09-15T01:00:00+0000")],
      paging: {
        cursors: { after: "cursor-1" },
        next: "https://untrusted.example.com/?access_token=do-not-follow",
      },
    },
    {
      data: [
        {
          ...media("old", "2026-09-13T01:00:00+0000"),
          media_type: "VIDEO",
          thumbnail_url: "https://cdn.example.com/thumb.jpg",
        },
      ],
      paging: { cursors: { after: "cursor-2" }, next: "exists" },
    },
  ]);
  const entries = await createInstagramSource(stub.options).read(new Date("2026-09-14T00:00:00Z"));
  expect(entries.map((entry) => entry.id)).toEqual(["new", "old"]);
  expect(entries[1]?.imageUrl).toBe("https://cdn.example.com/thumb.jpg");
  expect(entries[0]?.publishedAt).toBe("2026-09-15T01:00:00+00:00");
  expect(stub.calls).toHaveLength(3);
  expect(stub.calls[2]?.searchParams.get("after")).toBe("cursor-1");
  expect(
    stub.calls.every(
      (url) =>
        url.origin === "https://graph.instagram.com" && !url.searchParams.has("access_token"),
    ),
  ).toBe(true);
});

test("Instagram rejects the wrong signed-in account before fetching media", async () => {
  const stub = instagramMock([], "someone-else");
  expect(
    await createInstagramSource(stub.options)
      .read(new Date())
      .catch((cause: unknown) => cause),
  ).toBeInstanceOf(InvalidInput);
  expect(stub.calls).toHaveLength(1);
});

test("Instagram does not commit a partial result when pagination repeats", async () => {
  const page = {
    data: [media("new", "2026-09-15T01:00:00+0000")],
    paging: { cursors: { after: "loop" }, next: "exists" },
  };
  const stub = instagramMock([page, page]);
  expect(
    await createInstagramSource(stub.options)
      .read(new Date("2026-09-14"))
      .catch((cause: unknown) => cause),
  ).toBeInstanceOf(RecoveryRequired);
});

test("refresh uses Meta's required query parameter and never exposes provider errors", async () => {
  const api = createInstagramClient({
    accountId,
    token: async () => "test-token",
    request: async (url) => {
      expect(url.pathname).toBe("/refresh_access_token");
      expect(url.searchParams.get("access_token")).toBe("test-token");
      return Response.json({ access_token: "refreshed-token", expires_in: 5_184_000 });
    },
  });
  expect(await api.refresh()).toEqual({ token: "refreshed-token", expiresIn: 5_184_000 });
  const rejected = createInstagramClient({
    accountId,
    token: async () => "test-token",
    request: async () =>
      new Response("provider body contains test-token", {
        status: 429,
        headers: { "Retry-After": "900" },
      }),
  });
  expect(await rejected.refresh().catch((cause: unknown) => cause)).toMatchObject({
    service: "Instagram refresh",
    retryAfterMs: 900_000,
  });
  try {
    await rejected.refresh();
  } catch (cause) {
    expect(cause).toBeInstanceOf(RateLimited);
    expect(JSON.stringify(cause)).not.toContain("test-token");
  }
});

test("blog Open Graph enrichment and common embed fields respect Discord limits", async () => {
  const source = createBlogSource();
  const post: SocialPost = {
    id: "project",
    url: "https://blog.purduehackers.com/posts/project/",
    title: "x".repeat(300),
    text: "@everyone ".repeat(600),
    publishedAt: "2026-09-15T01:00:00Z",
  };
  const enriched = await enrichSocialPost(source, post, async (url) => {
    expect(url.pathname).toBe("/posts/project");
    return new Response('<meta property="og:image" content="/og/project.png">');
  });
  const embed = socialEmbed(source, enriched);
  expect(embed.title?.length).toBe(256);
  expect(embed.title).toBe(`${"X".repeat(255)}…`);
  expect(embed.color).toBe(0xf5c842);
  expect(embed.description?.length).toBe(3_800);
  expect(embed.url).toBe(post.url);
  expect(embed.image?.url).toBe("https://blog.purduehackers.com/og/project.png");
  expect(
    await enrichSocialPost(source, post, async () => new Response("bad gateway", { status: 502 })),
  ).toEqual(post);
});

test.each([
  ["Short caption", "Short caption"],
  ["x".repeat(125), "x".repeat(125)],
  [`${"x".repeat(125)} next`, `${"x".repeat(125)}…`],
  [`Hello ${"x".repeat(126)}`, "Hello…"],
  ["x".repeat(126), "…"],
  ["🦆 ".repeat(64), `${"🦆 ".repeat(62)}🦆…`],
])("YouTube and Instagram keep whole words in caption previews: %s", (text, expected) => {
  const adapters = [
    createYouTubeSource(),
    createInstagramSource({ accountId, token: async () => "unused" }),
  ];
  for (const source of adapters) {
    const embed = socialEmbed(source, {
      id: "preview",
      title: "Original title",
      url: source.profileUrl,
      text,
      publishedAt: "2026-09-15T01:00:00Z",
    });
    expect(embed.description).toBe(expected);
    expect(embed.title).toBe("Original title");
    expect(embed.color).toBe(source.id === "youtube" ? 0xff0033 : 0xff0069);
  }
});
