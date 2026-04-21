import { env } from "@/env";

import type { MediaUploadInput, PayloadListResult, PayloadMedia } from "./types";

type ServiceAccountAuth = { cmsUrl: string; apiKey: string };

function authHeaders(auth: ServiceAccountAuth): Record<string, string> {
  return {
    Authorization: `service-accounts API-Key ${auth.apiKey}`,
  };
}

function defaultAuth(): ServiceAccountAuth {
  return {
    cmsUrl: env.PAYLOAD_CMS_URL,
    apiKey: env.PAYLOAD_SERVICE_ACCOUNT_API_KEY,
  };
}

export async function uploadMedia(
  input: MediaUploadInput,
  auth: ServiceAccountAuth = defaultAuth(),
): Promise<PayloadMedia> {
  const form = new FormData();
  const bytes = new Uint8Array(input.buffer);
  form.append("file", new Blob([bytes], { type: input.contentType }), input.filename);
  form.append(
    "_payload",
    JSON.stringify({
      alt: input.alt,
      batchId: input.batchId,
      discordMessageId: input.discordMessageId,
      discordUserId: input.discordUserId,
      source: input.source ?? "manual",
    }),
  );

  const res = await fetch(`${auth.cmsUrl}/api/media`, {
    method: "POST",
    headers: authHeaders(auth),
    body: form,
  });
  if (!res.ok) {
    throw new Error(`payload media upload failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { doc: PayloadMedia };
  return json.doc;
}

export async function findMediaByDiscordMessageId(
  discordMessageId: string,
  auth: ServiceAccountAuth = defaultAuth(),
): Promise<PayloadListResult<PayloadMedia>> {
  const url = new URL(`${auth.cmsUrl}/api/media`);
  url.searchParams.set("where[discordMessageId][equals]", discordMessageId);
  url.searchParams.set("depth", "0");
  url.searchParams.set("limit", "50");

  const res = await fetch(url, { headers: authHeaders(auth) });
  if (!res.ok) {
    throw new Error(`payload media query failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PayloadListResult<PayloadMedia>;
}

export async function findMediaByBatchId(
  batchId: string,
  auth: ServiceAccountAuth = defaultAuth(),
): Promise<PayloadListResult<PayloadMedia>> {
  const url = new URL(`${auth.cmsUrl}/api/media`);
  url.searchParams.set("where[batchId][equals]", batchId);
  url.searchParams.set("depth", "0");
  url.searchParams.set("limit", "1000");

  const res = await fetch(url, { headers: authHeaders(auth) });
  if (!res.ok) {
    throw new Error(`payload batch query failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PayloadListResult<PayloadMedia>;
}

export async function deleteMedia(
  id: number,
  auth: ServiceAccountAuth = defaultAuth(),
): Promise<void> {
  const res = await fetch(`${auth.cmsUrl}/api/media/${id}`, {
    method: "DELETE",
    headers: authHeaders(auth),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`payload media delete failed: ${res.status} ${await res.text()}`);
  }
}
