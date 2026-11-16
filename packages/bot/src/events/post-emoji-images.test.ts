import { describe, expect, spyOn, test } from "bun:test";

import type { Embed } from "discord.js";
import sharp from "sharp";

import { loadPostImages, postImageUrls, preparePostImage } from "./post-emoji-images.ts";

function attachment(url: string, name = "work.png") {
  return { url, name, size: 100, contentType: "image/png" };
}

type PostEmbed = Pick<Embed, "image" | "thumbnail">;

function media(files: ReturnType<typeof attachment>[] = [], embeds: PostEmbed[] = []) {
  return { attachments: new Map(files.map((item, index) => [String(index), item])), embeds };
}

function post(items: ReturnType<typeof attachment>[] = [], embeds: PostEmbed[] = []) {
  return { ...media(items, embeds), messageSnapshots: new Map<string, ReturnType<typeof media>>() };
}

describe("post images", () => {
  test("includes direct and forwarded attachments and Discord-proxied embeds", () => {
    const direct = "https://cdn.discordapp.com/attachments/1/2/direct.png?ex=signature";
    const forwarded = "https://cdn.discordapp.com/attachments/1/3/forwarded.png";
    const proxy = "https://media.discordapp.net/external/abcd/example.org/work.png";
    const message = post(
      [attachment(direct)],
      [
        {
          image: { url: "https://example.org/work.png", proxyURL: proxy },
          thumbnail: { url: "https://example.org/work.png", proxyURL: proxy },
        },
      ],
    );
    message.messageSnapshots.set("forward", media([attachment(forwarded), attachment(direct)]));
    expect(postImageUrls(message).map((url) => url.href)).toEqual([direct, forwarded, proxy]);
  });

  test("rejects arbitrary URLs and oversized files, caps the image count", () => {
    const message = post([
      attachment("http://cdn.discordapp.com/work.png"),
      attachment("https://cdn.discordapp.com.evil.test/work.png"),
      attachment("https://127.0.0.1/work.png"),
      attachment("https://user:password@cdn.discordapp.com/work.png"),
      { ...attachment("https://cdn.discordapp.com/large.png"), size: 20_000_000 },
      ...Array.from({ length: 12 }, (_, index) =>
        attachment(`https://cdn.discordapp.com/${index}.png`),
      ),
    ]);
    expect(postImageUrls(message)).toHaveLength(10);
    expect(postImageUrls(message)[0]?.pathname).toBe("/0.png");
  });

  test("converts and pads narrow transparent images into valid still JPEGs", async () => {
    const source = await sharp({
      create: { width: 2_000, height: 100, channels: 4, background: "transparent" },
    })
      .webp()
      .toBuffer();
    const image = await preparePostImage(source);
    const metadata = await sharp(image.data).metadata();
    expect(image.mediaType).toBe("image/jpeg");
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1_024);
    expect(metadata.height).toBe(280);
    expect(metadata.hasAlpha).toBe(false);
  });

  test("downloads image bytes without auth and disallows redirects", async () => {
    const bytes = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_url: string | URL | Request, options?: RequestInit) => {
          expect(options?.redirect).toBe("error");
          expect(options?.headers).toBeUndefined();
          return new Response(bytes);
        },
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      const images = await loadPostImages(
        post([attachment("https://cdn.discordapp.com/work.png")]),
      );
      expect(images).toHaveLength(1);
      expect(images[0]?.data.byteLength).toBeGreaterThan(0);
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      request.mockRestore();
    }
  });
});
