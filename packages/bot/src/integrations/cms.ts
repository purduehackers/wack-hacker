/**
 * Hack night photo archive in Payload CMS.
 *
 * Photos posted in a hack night images thread are uploaded to the `media`
 * collection, tagged `source: "hack-night"` and filed under the event slug in
 * `batchId`. The Sunday cleanup job reads them back to count photos and rank
 * photographers.
 *
 * Two things worth stating:
 *
 * - Listing is paginated with a hard page cap. An unbounded loop over a
 *   collection this job does not own is how a cleanup job turns into an outage;
 *   hitting the cap truncates and says so rather than spinning.
 * - Uploads are idempotent on `discordMessageId`. Reposting the same message —
 *   which a gateway `RESUME` can cause — must not duplicate the photo, and the
 *   count that drives the leaderboard depends on that.
 */

import { PayloadSDK } from "@payloadcms/sdk";
import { Transient, UpstreamError, httpStatusOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";

const COLLECTION = "media";
const SOURCE = "hack-night";
const LIST_PAGE_SIZE = 100;
const LIST_PAGE_CAP = 20;

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
}

export type CmsError = Transient | UpstreamError;

interface MediaDoc {
  readonly id?: number | string;
  readonly filename?: string;
  readonly url?: string;
  readonly discordMessageId?: string;
  readonly discordUserId?: string;
  readonly createdAt?: string;
}

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

function toCmsError(operation: string) {
  return (cause: unknown): CmsError => {
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

export function createCmsClient(deps: CmsDeps) {
  const payload = new PayloadSDK({
    baseInit: { headers: { Authorization: `users API-Key ${deps.apiKey}` } },
    baseURL: `${deps.baseUrl ?? CMS_URL}/api`,
  });

  return {
    /** Every photo filed under an event slug, oldest first. */
    listImages: async (slug: string): Promise<Result<readonly HackNightImage[], CmsError>> =>
      Result.tryPromise(
        {
          try: async () => {
            const images: HackNightImage[] = [];

            for (let page = 1; page <= LIST_PAGE_CAP; page += 1) {
              const found = await payload.find({
                collection: COLLECTION,
                limit: LIST_PAGE_SIZE,
                page,
                sort: "createdAt",
                where: { source: { equals: SOURCE }, batchId: { equals: slug } },
              });

              for (const doc of found.docs) images.push(project(doc));
              if (page >= found.totalPages) return images;
            }

            // Truncating loudly beats looping over a collection we do not own.
            console.warn(
              `listImages(${slug}) hit the ${LIST_PAGE_CAP}-page cap; truncated at ${images.length}`,
            );
            return images;
          },
          catch: toCmsError("list hack night images"),
        },
        upstreamRetry,
      ),

    /** True when a photo for this Discord message is already filed. */
    hasImageForMessage: async (
      slug: string,
      discordMessageId: string,
    ): Promise<Result<boolean, CmsError>> =>
      Result.tryPromise(
        {
          try: async () => {
            const found = await payload.find({
              collection: COLLECTION,
              limit: 1,
              where: {
                source: { equals: SOURCE },
                batchId: { equals: slug },
                discordMessageId: { equals: discordMessageId },
              },
            });
            return found.docs.length > 0;
          },
          catch: toCmsError("check hack night image"),
        },
        upstreamRetry,
      ),

    /** Removes every photo filed against a Discord message. Returns the count. */
    deleteImagesForMessage: async (
      slug: string,
      discordMessageId: string,
    ): Promise<Result<number, CmsError>> =>
      Result.tryPromise(
        {
          try: async () => {
            const deleted = await payload.delete({
              collection: COLLECTION,
              where: {
                source: { equals: SOURCE },
                batchId: { equals: slug },
                discordMessageId: { equals: discordMessageId },
              },
            });
            return deleted.docs.length;
          },
          catch: toCmsError("delete hack night images"),
        },
        upstreamRetry,
      ),
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
