import { z } from "zod";

import { MAX_ARTIFACT_BYTES, saveArtifact } from "./store.ts";
import type { ArtifactScope } from "./store.ts";

export const attachmentUrlSchema = z.url().refine((value) => {
  try {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) &&
      /^\/attachments\/\d+\/\d+\/[^/]+$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}, "Expected a Discord attachment HTTPS URL");

/** Copy an attached file before its signed Discord URL expires. No arbitrary fetch URLs. */
export async function importAttachment(
  url: string,
  scope: ArtifactScope,
  key: string,
  signal: AbortSignal,
) {
  attachmentUrlSchema.parse(url);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw new Error("Discord attachment is unavailable or its URL expired");
  const mediaType = (response.headers.get("content-type") ?? "").split(";")[0] ?? "";
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/quicktime",
      "application/pdf",
    ].includes(mediaType)
  )
    throw new Error("Unsupported media type; use PNG, JPEG, WebP, GIF, MP4, MOV or PDF");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Attachment has no body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.length;
    if (length > MAX_ARTIFACT_BYTES) {
      await reader.cancel();
      throw new Error(
        "Attachment exceeds 8 MB; supply an existing stable public media URL for larger files",
      );
    }
    chunks.push(next.value);
  }
  const filename = (new URL(url).pathname.split("/").at(-1) ?? "media")
    .replaceAll(/[^\w.-]/gu, "_")
    .slice(-100);
  return saveArtifact(scope, {
    key,
    kind: "media",
    filename,
    mediaType,
    body: Buffer.concat(chunks),
    metadata: { source: "Discord attachment" },
  });
}
