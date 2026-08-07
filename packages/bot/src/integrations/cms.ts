/** Hack Night photo archive backed by Payload's documented REST API. */

import { Transient, UpstreamError, httpStatusOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";
import { z } from "zod";

const COLLECTION = "media";
const SOURCE = "hack-night";
const LIST_PAGE_SIZE = 100;
const LIST_PAGE_CAP = 20;
const FETCH_TIMEOUT_MS = 15_000;

export interface HackNightImage {
  readonly id: number | string;
  readonly filename: string;
  readonly url: string;
  readonly discordMessageId: string;
  readonly discordUserId: string;
  readonly uploadedAt: string;
}

export interface UploadImageInput {
  readonly url: string;
  readonly slug: string;
  readonly discordMessageId: string;
  readonly discordUserId: string;
  readonly filename: string;
  readonly contentType: string;
}

export type CmsError = Transient | UpstreamError;

const mediaDocSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  filename: z.string().optional(),
  url: z.string().optional(),
  discordMessageId: z.string().optional(),
  discordUserId: z.string().optional(),
  createdAt: z.string().optional(),
});
const mediaListSchema = z.object({
  docs: z.array(mediaDocSchema),
  totalPages: z.number().int().nonnegative(),
});
const mediaMutationSchema = z.object({ doc: mediaDocSchema });
const mediaDeleteSchema = z.object({ docs: z.array(mediaDocSchema) });

type MediaDoc = z.infer<typeof mediaDocSchema>;

function project(doc: MediaDoc): HackNightImage {
  return {
    id: doc.id ?? "",
    filename: doc.filename ?? "",
    url: doc.url ?? "",
    discordMessageId: doc.discordMessageId ?? "",
    discordUserId: doc.discordUserId ?? "",
    uploadedAt: doc.createdAt ?? "",
  };
}

function altTextFor(slug: string, filename: string): string {
  return `Hack Night ${slug.replace(/^hack-night-/, "")} photo — ${filename}`;
}

function toCmsError(operation: string) {
  return (cause: unknown): CmsError => {
    if (cause instanceof UpstreamError || cause instanceof Transient) return cause;
    const status = httpStatusOf(cause);
    const detail = cause instanceof Error ? cause.message : String(cause);
    return status !== undefined && status < 500
      ? new UpstreamError({ service: "payload-cms", status, detail })
      : new Transient({ operation, detail });
  };
}

export interface CmsDeps {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export const CMS_URL = "https://cms.purduehackers.com";

function mediaUrl(baseUrl: string, query: Readonly<Record<string, string>> = {}): URL {
  const url = new URL(`/api/${COLLECTION}`, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function payloadRequest<T>(
  schema: z.ZodType<T>,
  url: URL,
  apiKey: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `users API-Key ${apiKey}`);
  const response = await fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500) || response.statusText;
    throw new UpstreamError({ service: "payload-cms", status: response.status, detail });
  }

  const body = await response.json().catch((): unknown => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamError({
      service: "payload-cms",
      status: 502,
      detail: `invalid response: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}

function imageWhere(
  slug: string,
  discordMessageId?: string,
  filename?: string,
): Record<string, string> {
  const where: Record<string, string> = {
    "where[source][equals]": SOURCE,
    "where[batchId][equals]": slug,
  };
  if (discordMessageId !== undefined) {
    where["where[discordMessageId][equals]"] = discordMessageId;
  }
  if (filename !== undefined) where["where[filename][equals]"] = filename;
  return where;
}

interface CmsContext {
  readonly apiKey: string;
  readonly baseUrl: string;
}

function listImages(
  cms: CmsContext,
  slug: string,
): Promise<Result<readonly HackNightImage[], CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const images: HackNightImage[] = [];
        for (let page = 1; page <= LIST_PAGE_CAP; page += 1) {
          const found = await payloadRequest(
            mediaListSchema,
            mediaUrl(cms.baseUrl, {
              ...imageWhere(slug),
              limit: String(LIST_PAGE_SIZE),
              page: String(page),
              sort: "createdAt",
            }),
            cms.apiKey,
          );
          for (const doc of found.docs) images.push(project(doc));
          if (page >= found.totalPages) return images;
        }
        console.warn(
          `listImages(${slug}) hit the ${LIST_PAGE_CAP}-page cap; truncated at ${images.length}`,
        );
        return images;
      },
      catch: toCmsError("list hack night images"),
    },
    upstreamRetry,
  );
}

function uploadImage(
  cms: CmsContext,
  input: UploadImageInput,
): Promise<Result<HackNightImage, CmsError>> {
  return Result.tryPromise({
    try: async () => {
      const response = await fetch(input.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        throw new UpstreamError({
          service: "discord-cdn",
          status: response.status,
          detail: `could not fetch ${input.filename}`,
        });
      }
      const blob = await response.blob();
      const file = new File([blob], input.filename, {
        type: blob.type.length > 0 ? blob.type : input.contentType,
      });
      const form = new FormData();
      form.append("file", file);
      form.append(
        "_payload",
        JSON.stringify({
          alt: altTextFor(input.slug, input.filename),
          source: SOURCE,
          batchId: input.slug,
          discordMessageId: input.discordMessageId,
          discordUserId: input.discordUserId,
        }),
      );
      const created = await payloadRequest(mediaMutationSchema, mediaUrl(cms.baseUrl), cms.apiKey, {
        method: "POST",
        body: form,
      });
      return project(created.doc);
    },
    catch: toCmsError("upload hack night image"),
  });
}

function hasImageForMessage(
  cms: CmsContext,
  slug: string,
  discordMessageId: string,
  filename?: string,
): Promise<Result<boolean, CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const found = await payloadRequest(
          mediaListSchema,
          mediaUrl(cms.baseUrl, {
            ...imageWhere(slug, discordMessageId, filename),
            limit: "1",
          }),
          cms.apiKey,
        );
        return found.docs.length > 0;
      },
      catch: toCmsError("check hack night image"),
    },
    upstreamRetry,
  );
}

function deleteImagesForMessage(
  cms: CmsContext,
  slug: string,
  discordMessageId: string,
): Promise<Result<number, CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const deleted = await payloadRequest(
          mediaDeleteSchema,
          mediaUrl(cms.baseUrl, imageWhere(slug, discordMessageId)),
          cms.apiKey,
          { method: "DELETE" },
        );
        return deleted.docs.length;
      },
      catch: toCmsError("delete hack night images"),
    },
    upstreamRetry,
  );
}

export function createCmsClient(deps: CmsDeps) {
  const cms = { apiKey: deps.apiKey, baseUrl: deps.baseUrl ?? CMS_URL };
  return {
    listImages: (slug: string) => listImages(cms, slug),
    uploadImage: (input: UploadImageInput) => uploadImage(cms, input),
    hasImageForMessage: (slug: string, discordMessageId: string, filename?: string) =>
      hasImageForMessage(cms, slug, discordMessageId, filename),
    deleteImagesForMessage: (slug: string, discordMessageId: string) =>
      deleteImagesForMessage(cms, slug, discordMessageId),
  };
}

export type CmsClient = ReturnType<typeof createCmsClient>;

/**
 * Photo counts per Discord user, highest first.
 *
 * Split out from the schedule so the ranking is a plain function of the data,
 * independent of how the photos were fetched.
 */
export function rankPhotographers(
  images: readonly HackNightImage[],
): readonly { readonly userId: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const photo of images) {
    if (photo.discordUserId === "") continue;
    counts.set(photo.discordUserId, (counts.get(photo.discordUserId) ?? 0) + 1);
  }

  return [...counts]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count);
}
