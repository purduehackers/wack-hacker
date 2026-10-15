import { describe, expect, test } from "bun:test";

import { hiddenEmbedLinks, embedPreviewFor } from "./embed-links.ts";

const POST = "NASAWebb/status/1572558249307639809";
const FX_URL = `https://fx.purduehackers.com/t/${POST}`;

describe("Embedfix preview links", () => {
  test.each([
    `https://twitter.com/${POST}`,
    `https://x.com/${POST}?s=20&t=tracking`,
    `http://mobile.twitter.com/${POST}/`,
    `https://www.x.com/${POST}#fragment`,
    `https://m.twitter.com/${POST}`,
    `https://mobile.x.com/${POST}`,
    `Have a look: (https://x.com/${POST}).`,
    `[Neptune](https://x.com/${POST})`,
  ])("normalizes %s", (content) => {
    expect(embedPreviewFor(content)).toEqual({ links: [FX_URL], suppressOriginal: true });
  });

  test.each([
    "https://x.com/i/status/123",
    "https://twitter.com/i/web/status/123",
    `https://x.com/${POST}/photo/2`,
    `https://x.com/${POST}/video/1`,
  ])("preserves a supported post path: %s", (content) => {
    const expected = content.replace(
      /^https:\/\/(?:x|twitter)\.com/u,
      "https://fx.purduehackers.com/t",
    );
    expect(embedPreviewFor(content).links).toEqual([expected]);
  });

  test.each([
    `\`https://x.com/${POST}\``,
    `\`\`\`text\nhttps://x.com/${POST}\n\`\`\``,
    `<https://x.com/${POST}>`,
    `||https://x.com/${POST}||`,
    `[hidden](<https://x.com/${POST}>)`,
    `https://fx.purduehackers.com/t/${POST}`,
    `https://fxtwitter.com/${POST}`,
    `https://fixupx.com/${POST}`,
    `https://x.com.evil.example/${POST}`,
    `https://evil.example/?url=https://x.com/${POST}`,
    `https://x.com@evil.example/${POST}`,
    `https://user:password@x.com/${POST}`,
    `https://x.com:444/${POST}`,
    "https://x.com/NASAWebb",
    "https://x.com/home",
    "https://x.com/NASAWebb/status/not-a-number",
    "https://x.com/NASAWebb/status/0",
    `https://x.com/${POST}/anything-else`,
  ])("does not unfurl opted-out or unsupported content: %s", (content) => {
    expect(embedPreviewFor(content).links).toEqual([]);
  });

  test("deduplicates tracking, host, and trailing slash variants", () => {
    expect(
      embedPreviewFor(
        `https://x.com/${POST}?s=20 https://twitter.com/${POST}/ https://x.com/${POST}?t=other`,
      ),
    ).toEqual({ links: [FX_URL], suppressOriginal: true });
  });

  test("keeps unrelated previews visible in mixed-link messages", () => {
    expect(embedPreviewFor(`https://x.com/${POST} https://youtube.com/watch?v=123`)).toEqual({
      links: [FX_URL],
      suppressOriginal: false,
    });
  });

  test("bounds the reply and preserves originals when there are too many posts", () => {
    const content = Array.from(
      { length: 11 },
      (_, i) => `https://x.com/NASAWebb/status/${i + 1}`,
    ).join("\n");
    const preview = embedPreviewFor(content);
    expect(preview.links).toHaveLength(10);
    expect(preview.suppressOriginal).toBe(false);
    expect(hiddenEmbedLinks(preview.links).length).toBeLessThan(2_000);
  });

  test("uses the live-verified blank character without disabling unfurls", () => {
    expect(hiddenEmbedLinks([FX_URL, "https://fx.purduehackers.com/t/example/status/123"])).toBe(
      `[\u2800](${FX_URL})\n[\u2800](https://fx.purduehackers.com/t/example/status/123)`,
    );
  });
});

describe("Instagram and SoundCloud routes", () => {
  test.each([
    ["https://www.instagram.com/reel/Cop84x6u7CP/?igsh=tracking", "i/reel/Cop84x6u7CP"],
    [
      "https://instagram.com/p/BQ0eAlwhDrw/?img_index=2&igshid=tracking",
      "i/p/BQ0eAlwhDrw?img_index=2",
    ],
    ["https://m.instagram.com/enbiggen/reels/Cop84x6u7CP/", "i/enbiggen/reels/Cop84x6u7CP"],
    ["https://instagram.com/tv/Cop84x6u7CP/3", "i/tv/Cop84x6u7CP/3"],
    [
      "https://soundcloud.com/hewillyeah/2f-2-08-14-2026?si=tracking",
      "s/hewillyeah/2f-2-08-14-2026",
    ],
    ["https://www.soundcloud.com/artist/sets/playlist/", "s/artist/sets/playlist"],
    ["https://m.soundcloud.com/artist/track", "s/artist/track"],
    ["https://mobile.soundcloud.com/artist/track", "s/artist/track"],
    ["https://on.soundcloud.com/Abc123Def?si=tracking", "s/Abc123Def"],
  ])("routes %s to the deployed Embedfix path", (content, path) => {
    expect(embedPreviewFor(content)).toEqual({
      links: [`https://fx.purduehackers.com/${path}`],
      suppressOriginal: true,
    });
  });

  test.each([
    "https://instagram.com/enbiggen",
    "https://instagram.com/stories/enbiggen/12345",
    "https://instagram.com/reel/abc",
    "https://instagram.com/p/BQ0eAlwhDrw?img_index=0",
    "https://instagram.com/p/BQ0eAlwhDrw?img_index=21",
    "https://instagram.com/p/BQ0eAlwhDrw?img_index=2%29",
    "https://instagram.com.evil.example/p/BQ0eAlwhDrw",
    "https://soundcloud.com/artist",
    "https://soundcloud.com/artist/track/s-secret",
    "https://soundcloud.com/artist/track?secret_token=s-secret",
    "https://on.soundcloud.com/artist/track",
    "https://on.soundcloud.com/abc",
    "https://soundcloud.com.evil.example/artist/track",
    "https://fx.purduehackers.com/i/p/BQ0eAlwhDrw",
    "https://fx.purduehackers.com/s/artist/track",
    "<https://instagram.com/p/BQ0eAlwhDrw>",
    "||https://soundcloud.com/artist/track||",
  ])("preserves unsupported, private, or already fixed links: %s", (content) => {
    expect(embedPreviewFor(content).links).toEqual([]);
  });
});

describe("multiple Embedfix links", () => {
  test("replaces supported platforms together and keeps carousel selections distinct", () => {
    const preview = embedPreviewFor(
      [
        `https://x.com/${POST}`,
        "https://instagram.com/p/BQ0eAlwhDrw?img_index=2&igsh=tracking",
        "https://www.instagram.com/p/BQ0eAlwhDrw/?img_index=2",
        "https://instagram.com/p/BQ0eAlwhDrw?img_index=3",
        "https://on.soundcloud.com/Abc123Def",
      ].join("\n"),
    );
    expect(preview).toEqual({
      links: [
        FX_URL,
        "https://fx.purduehackers.com/i/p/BQ0eAlwhDrw?img_index=2",
        "https://fx.purduehackers.com/i/p/BQ0eAlwhDrw?img_index=3",
        "https://fx.purduehackers.com/s/Abc123Def",
      ],
      suppressOriginal: true,
    });
  });

  test("fits Discord content limits even with long SoundCloud paths", () => {
    const content = Array.from(
      { length: 10 },
      (_, i) => `https://soundcloud.com/${"a".repeat(200)}/${"b".repeat(199)}${i}`,
    ).join("\n");
    const preview = embedPreviewFor(content);
    expect(preview.links).toHaveLength(4);
    expect(preview.suppressOriginal).toBe(false);
    expect(hiddenEmbedLinks(preview.links).length).toBeLessThanOrEqual(2_000);
  });
});
