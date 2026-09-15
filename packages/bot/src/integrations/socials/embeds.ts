import type { APIEmbed } from "discord-api-types/v10";

import { socialRequest } from "./http.ts";
import type { SocialFetch, SocialPlatform, SocialPost, SocialSource } from "./types.ts";

export const SOCIAL_BRAND_COLORS: Readonly<Record<SocialPlatform, number>> = {
  youtube: 0xff0033,
  blog: 0xf5c842,
  instagram: 0xff0069,
};

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Keep at most 125 characters of complete words, then indicate omitted text. */
function captionPreview(text: string): string {
  const caption = text.trim();
  const characters = Array.from(caption);
  if (characters.length <= 125) return caption;
  let end = 125;
  if (!/\s/u.test(characters[end] ?? "")) {
    while (end > 0 && !/\s/u.test(characters[end - 1] ?? "")) end--;
  }
  return `${characters.slice(0, end).join("").trimEnd()}…`;
}

/** Resolve a blog preview only when delivery needs it, using the published article. */
export async function enrichSocialPost(
  source: SocialSource,
  post: SocialPost,
  request?: SocialFetch,
): Promise<SocialPost> {
  if (source.id !== "blog" || post.imageUrl !== undefined) return post;
  const url = new URL(post.url);
  if (url.origin !== "https://blog.purduehackers.com") return post;
  // The feed includes a slash; the site's canonical article route omits it.
  url.pathname = url.pathname.replace(/\/$/u, "");
  try {
    const html = await socialRequest("blog preview", url, request);
    let imageUrl: string | undefined;
    await new HTMLRewriter()
      .on('meta[property="og:image"]', {
        element(element) {
          const content = element.getAttribute("content");
          const image = content ? URL.parse(content, url.href) : undefined;
          if (image?.protocol === "https:") imageUrl = image.href;
        },
      })
      .transform(new Response(html))
      .text();
    return { ...post, imageUrl };
  } catch {
    // A missing preview must not block a valid caption and source link.
    return post;
  }
}

export function socialEmbed(source: SocialSource, post: SocialPost): APIEmbed {
  const title = source.id === "blog" ? post.title.toUpperCase() : post.title;
  const description = source.id === "blog" ? truncate(post.text, 3_800) : captionPreview(post.text);
  return {
    color: SOCIAL_BRAND_COLORS[source.id],
    author: { name: `Purdue Hackers · ${source.name}`, url: source.profileUrl },
    title: truncate(title, 256),
    url: post.url,
    ...(description ? { description } : {}),
    ...(post.imageUrl === undefined ? {} : { image: { url: post.imageUrl } }),
    timestamp: new Date(post.publishedAt).toISOString(),
    footer: { text: source.name },
  };
}
