import { messageOf } from "@repo/shared/errors";
import type { Attachment, Embed } from "discord.js";
import sharp from "sharp";

export interface PostEmojiImage {
  readonly data: Uint8Array;
  readonly mediaType: "image/jpeg";
}

interface MediaContent {
  readonly attachments: {
    values(): IterableIterator<Pick<Attachment, "url" | "contentType" | "name" | "size">>;
  };
  readonly embeds: readonly Pick<Embed, "image" | "thumbnail">[];
}

interface PostImageMessage extends MediaContent {
  readonly messageSnapshots: { values(): IterableIterator<MediaContent> };
}

const MAX_IMAGES = 10;
const MAX_INPUT_BYTES = 12 * 1_024 * 1_024;
const TRUSTED_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

function discordImageUrl(value: string): URL | undefined {
  const url = URL.parse(value);
  if (
    !url ||
    url.protocol !== "https:" ||
    !TRUSTED_HOSTS.has(url.hostname) ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return undefined;
  }
  return url;
}

/** Direct/forwarded attachments first, then Discord-proxied embed images. */
export function postImageUrls(message: PostImageMessage): readonly URL[] {
  const posts = [message, ...message.messageSnapshots.values()];
  const urls = new Map<string, URL>();
  const add = (value: string) => {
    const url = discordImageUrl(value);
    if (url) {
      const key = `${url.origin}${url.pathname}`;
      if (!urls.has(key)) urls.set(key, url);
    }
  };
  for (const source of posts) {
    for (const attachment of source.attachments.values()) {
      if (
        attachment.size <= MAX_INPUT_BYTES &&
        (attachment.contentType?.startsWith("image/") ||
          /\.(?:png|jpe?g|gif|webp|avif|heic)$/iu.test(attachment.name))
      ) {
        add(attachment.url);
      }
    }
  }
  for (const source of posts) {
    for (const embed of source.embeds) {
      for (const image of [embed.image, embed.thumbnail]) {
        if (image) add(image.proxyURL ?? image.url);
      }
    }
  }
  return [...urls.values()].slice(0, MAX_IMAGES);
}

/** Jev accepts still JPEG/PNG, each side 280–1568px. Preserve the whole frame. */
export async function preparePostImage(data: Uint8Array): Promise<PostEmojiImage> {
  if (data.byteLength > MAX_INPUT_BYTES) throw new Error("Post image exceeds byte limit");
  const resized = await sharp(data, { limitInputPixels: 40_000_000, pages: 1 })
    .rotate()
    .resize({ width: 1_024, height: 1_024, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "white" })
    .jpeg({ quality: 85, progressive: false })
    .timeout({ seconds: 3 })
    .toBuffer({ resolveWithObject: true });
  const padded = await sharp(resized.data)
    .extend({
      top: 0,
      bottom: Math.max(0, 280 - resized.info.height),
      left: 0,
      right: Math.max(0, 280 - resized.info.width),
      background: "white",
    })
    .jpeg({ quality: 85, progressive: false })
    .toBuffer();
  return { data: padded, mediaType: "image/jpeg" };
}

async function downloadImage(url: URL, signal: AbortSignal): Promise<PostEmojiImage> {
  // Never follow a CDN redirect to an arbitrary host. No Discord auth is sent.
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`Post image HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_INPUT_BYTES) throw new Error("Post image exceeds byte limit");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return preparePostImage(Buffer.concat(chunks));
}

/** Download once; the prepared bytes are reused for all scoring batches. */
export async function loadPostImages(
  message: PostImageMessage,
): Promise<readonly PostEmojiImage[]> {
  const urls = postImageUrls(message);
  const images: PostEmojiImage[] = [];
  const signal = AbortSignal.timeout(8_000);
  for (let index = 0; index < urls.length; index += 3) {
    const outcomes = await Promise.allSettled(
      urls.slice(index, index + 3).map((target) => downloadImage(target, signal)),
    );
    for (const result of outcomes) {
      if (result.status === "fulfilled") images.push(result.value);
      else
        console.warn("could not prepare post image for emoji selection", messageOf(result.reason));
    }
  }
  return images;
}
