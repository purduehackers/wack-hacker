const SOURCES = [
  {
    hosts: new Set([
      "twitter.com",
      "www.twitter.com",
      "mobile.twitter.com",
      "m.twitter.com",
      "x.com",
      "www.x.com",
      "mobile.x.com",
      "m.x.com",
    ]),
    route: "t",
    path: /^\/(?:\w{1,15}\/status|i\/(?:web\/)?status)\/[1-9]\d{0,24}(?:\/(?:photo|video)\/(?:[1-9]|1\d|20))?\/?$/u,
  },
  {
    hosts: new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]),
    route: "i",
    path: /^\/(?:[\w.]{1,30}\/)?(?:p|reel|reels|tv)\/[\w-]{5,32}(?:\/(?:[1-9]|1\d|20))?\/?$/u,
  },
  {
    hosts: new Set([
      "soundcloud.com",
      "www.soundcloud.com",
      "m.soundcloud.com",
      "mobile.soundcloud.com",
    ]),
    route: "s",
    path: /^\/[\w-]{1,200}\/(?:sets\/)?[\w-]{1,200}\/?$/u,
  },
  {
    hosts: new Set(["on.soundcloud.com"]),
    route: "s",
    path: /^\/[a-zA-Z0-9]{4,100}\/?$/u,
  },
];

const MAX_PREVIEWS = 10;
const MAX_CONTENT_LENGTH = 2_000;

function embedfixUrl(value: string): string | undefined {
  const url = URL.parse(value.replace(/[)\].,;!?:'*~]+$/u, ""));
  if (!url || url.username !== "" || url.password !== "" || url.port !== "") return undefined;

  const source = SOURCES.find((candidate) => candidate.hosts.has(url.hostname));
  if (!source?.path.test(url.pathname)) return undefined;
  // Embedfix handles public posts; don't strip access tokens from private links.
  if (source.route === "s" && url.searchParams.has("secret_token")) return undefined;

  const selection =
    source.route === "i" ? (url.searchParams.get("img_index") ?? undefined) : undefined;
  if (selection !== undefined && !/^(?:[1-9]|1\d|20)$/u.test(selection)) return undefined;

  // Keep media selection, but discard sharing trackers and arbitrary Markdown.
  const path = url.pathname.replace(/\/$/u, "");
  const query = selection ? `?img_index=${selection}` : "";
  return `https://fx.purduehackers.com/${source.route}${path}${query}`;
}

export function embedPreviewFor(content: string) {
  // Respect code, spoilers, and the author's explicit <URL> unfurl opt-out.
  const visible = content.replace(/(`+)[\s\S]*?\1|<https?:\/\/[^>]+>|\|\|[\s\S]*?\|\|/giu, "");
  const candidates = [...visible.matchAll(/https?:\/\/[^\s<>`|]+/giu)].map((match) => match[0]);
  const replacements = candidates.map(embedfixUrl);
  const unique = [...new Set(replacements.filter((url) => url !== undefined))];
  const links: string[] = [];
  for (const url of unique) {
    if (
      links.length === MAX_PREVIEWS ||
      hiddenEmbedLinks([...links, url]).length > MAX_CONTENT_LENGTH
    )
      break;
    links.push(url);
  }

  return {
    links,
    // Suppression affects the whole source message. Preserve unrelated previews
    // and any posts beyond Discord's limit instead of silently hiding them.
    suppressOriginal:
      replacements.every((url) => url !== undefined) && links.length === unique.length,
  };
}

export function hiddenEmbedLinks(links: readonly string[]): string {
  // Verified in Discord: NBSP, zero-width space, and Hangul filler leave the
  // Markdown literal visible. U+2800 BRAILLE PATTERN BLANK masks and unfurls.
  return links.map((url) => `[\u2800](${url})`).join("\n");
}
