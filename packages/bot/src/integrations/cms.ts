/**
 * The Purdue Hackers CMS, as far as the bot is concerned: an image archive, and
 * the events those images belong to.
 *
 * Two joins live here, and they fail independently.
 *
 * `batchId` is the durable one. Every image the bot files carries its drop's
 * batch id, and Payload indexes that field precisely so a human can filter the
 * media library by batch and bulk-attach the result. It asks nothing of the CMS
 * beyond permission to create media, which is what the bot's `wack_hacker` role
 * grants.
 *
 * `events.images[]` is the convenient one: it is what puts photos on the events
 * site without anyone opening the admin UI. Writing it is an `update` on
 * `events`, which Payload gates behind `editor` — a service account holding only
 * `wack_hacker` can upload all night and still be refused here. The refusal is a
 * 403 rather than an outage, so callers degrade to batch-only instead of failing
 * the upload; `isPermissionDenied` is how they tell the two apart.
 */

import { httpStatusOf, messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";
import { z } from "zod";

const MEDIA = "media";
const EVENTS = "events";
/**
 * The collection the API key is looked up in, not a role.
 *
 * `PAYLOAD_CMS_API_KEY` belongs to a service account, and both `users` and
 * `service-accounts` set `useAPIKey`, so naming the wrong one is accepted as a
 * well-formed header and then resolves to no principal. The request proceeds
 * anonymously, which is only visible on the media fields gated by `loggedIn`:
 * `where[source]` and friends come back as "path cannot be queried" rather than
 * as a 401.
 */
const AUTH_COLLECTION = "service-accounts";
const LIST_PAGE_SIZE = 100;
const LIST_PAGE_CAP = 20;
/** Purdue Hackers has run a few hundred events, not tens of thousands. */
const EVENT_PAGE_CAP = 5;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Payload's `media.source` select, which is a closed set upstream: a value this
 * enum does not name is rejected by the CMS as a validation error, not stored.
 *
 * `hack-night` also carries a permission: the bot's role may only *delete* media
 * tagged with a source it owns, which is why every bot-driven upload uses one of
 * these two rather than falling back to `manual`.
 */
export const MediaSource = {
  /** The weekly hack night photo thread. */
  HackNight: "hack-night",
  /** Any other `/image-drop` thread, filed against a CMS event. */
  Drop: "discord-drop",
} as const;

export type MediaSource = (typeof MediaSource)[keyof typeof MediaSource];

/** The archive coordinates one upload is filed under. */
export interface MediaBatch {
  /** Payload's `batchId`. A CMS event slug when the drop is linked to one. */
  readonly batchId: string;
  readonly source: MediaSource;
}

export interface DropImage {
  readonly id: number | string;
  readonly filename: string;
  readonly url: string;
  readonly discordMessageId: string;
  readonly discordUserId: string;
  readonly uploadedAt: string;
}

/** The parts of an `events` document the bot needs to name and link one. */
export interface CmsEvent {
  readonly id: number | string;
  readonly slug: string;
  readonly name: string;
}

/**
 * A listed event, with the two fields that only matter for *choosing* one.
 *
 * Kept apart from `CmsEvent` because that shape is stored in a drop's Redis
 * record under a strict schema: widening it there would reject every record
 * written by the version before it.
 */
export interface CmsEventSummary extends CmsEvent {
  readonly start?: string;
  readonly published?: boolean;
}

export interface UploadImageInput {
  readonly batch: MediaBatch;
  readonly url: string;
  readonly alt: string;
  readonly discordMessageId: string;
  readonly discordUserId: string;
  readonly filename: string;
  readonly contentType: string;
}

export type CmsError = Transient | UpstreamError;

const documentId = z.union([z.string(), z.number()]);

const mediaDocSchema = z.object({
  id: documentId,
  filename: z.string().optional(),
  url: z.string().optional(),
  discordMessageId: z.string().optional(),
  discordUserId: z.string().optional(),
  createdAt: z.string().optional(),
});
const mediaListSchema = z.object({
  docs: z.array(mediaDocSchema),
  totalPages: z.int().nonnegative(),
});
const mediaMutationSchema = z.object({ doc: mediaDocSchema });
const mediaDeleteSchema = z.object({ docs: z.array(mediaDocSchema) });

/**
 * An `events.images[]` row.
 *
 * `image` arrives as a bare id at `depth=0` and as the populated media document
 * otherwise, and the row keeps its own `id` — preserved on write so a PATCH
 * edits the existing rows rather than replacing every one of them.
 */
const eventImageRowSchema = z.object({
  id: documentId.optional(),
  image: z.union([documentId, z.object({ id: documentId.optional() })]).optional(),
});
const eventDocSchema = z.object({
  id: documentId,
  slug: z.string().optional(),
  name: z.string().optional(),
  start: z.string().optional(),
  published: z.boolean().optional(),
  images: z.array(eventImageRowSchema).optional(),
});
const eventListSchema = z.object({
  docs: z.array(eventDocSchema),
  totalPages: z.int().nonnegative(),
});
const eventMutationSchema = z.object({ doc: eventDocSchema });

type MediaDoc = z.output<typeof mediaDocSchema>;
type EventDoc = z.output<typeof eventDocSchema>;
type DocumentId = z.output<typeof documentId>;

function project(doc: MediaDoc): DropImage {
  return {
    id: doc.id,
    filename: doc.filename ?? "",
    url: doc.url ?? "",
    discordMessageId: doc.discordMessageId ?? "",
    discordUserId: doc.discordUserId ?? "",
    uploadedAt: doc.createdAt ?? "",
  };
}

/** Postgres numbers and Mongo strings both reach us, sometimes for the same id. */
function sameId(left: DocumentId, right: DocumentId): boolean {
  return String(left) === String(right);
}

interface ImageRow {
  readonly id?: DocumentId;
  readonly image: DocumentId;
}

/**
 * The media id behind an `images[].image`, whichever shape Payload sent.
 *
 * A relationship arrives as a bare id at `depth=0` and as the populated document
 * otherwise; the union collapses both to the id without asking what the value
 * looks like at runtime.
 */
const imageRelationSchema = z.union([
  z.object({ id: documentId.optional() }),
  documentId.transform((id) => ({ id })),
]);

function imageIdOf(value: unknown): DocumentId | undefined {
  const parsed = imageRelationSchema.safeParse(value);
  return parsed.success ? parsed.data.id : undefined;
}

/** The rows of `events.images[]`, flattened to ids and stripped of empty ones. */
function imageRows(event: EventDoc): readonly ImageRow[] {
  const rows: ImageRow[] = [];
  for (const entry of event.images ?? []) {
    const image = imageIdOf(entry.image);
    if (image === undefined) continue;
    rows.push(entry.id === undefined ? { image } : { id: entry.id, image });
  }
  return rows;
}

/**
 * Payload's own slug shape: its `createSlugFromName` lowercases, keeps `a-z0-9.`,
 * and joins the rest with hyphens. Checking a slug before sending it turns a typo
 * into an answer rather than a round trip that comes back empty for an
 * unexplained reason.
 */
export function isEventSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*$/.test(value);
}

export function isPermissionDenied(error: unknown): boolean {
  return UpstreamError.is(error) && (error.status === 401 || error.status === 403);
}

function toCmsError(operation: string) {
  return (cause: unknown): CmsError => {
    if (cause instanceof UpstreamError || cause instanceof Transient) return cause;
    const status = httpStatusOf(cause);
    const detail = messageOf(cause);
    return status !== undefined && status < 500
      ? new UpstreamError({ service: "payload-cms", status, detail })
      : new Transient({ operation, detail });
  };
}

export interface CmsDeps {
  readonly apiKey: string;
}

const CMS_URL = "https://cms.purduehackers.com";

function collectionUrl(
  baseUrl: string,
  collection: string,
  query: Readonly<Record<string, string>> = {},
): URL {
  const url = new URL(`/api/${collection}`, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

function documentUrl(baseUrl: string, collection: string, id: DocumentId): URL {
  return new URL(`/api/${collection}/${encodeURIComponent(String(id))}?depth=0`, baseUrl);
}

async function payloadRequest<S extends z.ZodType>(
  schema: S,
  url: URL,
  apiKey: string,
  init: RequestInit = {},
): Promise<z.output<S>> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `${AUTH_COLLECTION} API-Key ${apiKey}`);
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

function batchWhere(
  batch: MediaBatch,
  discordMessageId?: string,
  filename?: string,
): Record<string, string> {
  const where: Record<string, string> = {
    "where[source][equals]": batch.source,
    "where[batchId][equals]": batch.batchId,
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
  /** Per-event serialization for `events.images[]`. See `serialize`. */
  readonly writes: Map<string, Promise<unknown>>;
}

/**
 * Runs `work` after every earlier call for the same key has settled.
 *
 * `events.images[]` has no atomic append: a link is read-modify-write over the
 * whole array, so two photos posted at the same second would otherwise read the
 * same array and the second write would drop the first image. Uploads are
 * concurrent across messages, so without this the archive silently loses links.
 *
 * In-process only, which is the honest bound: two bot instances overlapping
 * during a deploy can still interleave. `attachImages` therefore verifies its own
 * write and retries, which covers the case this queue cannot.
 */
function serialize<T>(queue: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>) {
  const previous = queue.get(key) ?? Promise.resolve();
  const result = previous.then(work);
  // The queued handle must never reject, or the next caller inherits the
  // rejection; the handle returned to *this* caller still does.
  const settled: Promise<unknown> = result.then(
    () => undefined,
    () => undefined,
  );
  queue.set(key, settled);
  void settled.then(() => {
    if (queue.get(key) === settled) queue.delete(key);
  });
  return result;
}

function listImages(
  cms: CmsContext,
  batch: MediaBatch,
): Promise<Result<readonly DropImage[], CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const images: DropImage[] = [];
        for (let page = 1; page <= LIST_PAGE_CAP; page += 1) {
          const found = await payloadRequest(
            mediaListSchema,
            collectionUrl(cms.baseUrl, MEDIA, {
              ...batchWhere(batch),
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
          `listImages(${batch.batchId}) hit the ${LIST_PAGE_CAP}-page cap; truncated at ${images.length}`,
        );
        return images;
      },
      catch: toCmsError("list drop images"),
    },
    upstreamRetry,
  );
}

function uploadImage(
  cms: CmsContext,
  input: UploadImageInput,
): Promise<Result<DropImage, CmsError>> {
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
          alt: input.alt,
          source: input.batch.source,
          batchId: input.batch.batchId,
          discordMessageId: input.discordMessageId,
          discordUserId: input.discordUserId,
        }),
      );
      const created = await payloadRequest(
        mediaMutationSchema,
        collectionUrl(cms.baseUrl, MEDIA),
        cms.apiKey,
        { method: "POST", body: form },
      );
      return project(created.doc);
    },
    catch: toCmsError("upload drop image"),
  });
}

function hasImageForMessage(
  cms: CmsContext,
  batch: MediaBatch,
  discordMessageId: string,
  filename?: string,
): Promise<Result<boolean, CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const found = await payloadRequest(
          mediaListSchema,
          collectionUrl(cms.baseUrl, MEDIA, {
            ...batchWhere(batch, discordMessageId, filename),
            limit: "1",
          }),
          cms.apiKey,
        );
        return found.docs.length > 0;
      },
      catch: toCmsError("check drop image"),
    },
    upstreamRetry,
  );
}

/** Deletes every image filed for one Discord message, returning what it removed. */
function deleteImagesForMessage(
  cms: CmsContext,
  batch: MediaBatch,
  discordMessageId: string,
): Promise<Result<readonly DropImage[], CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const deleted = await payloadRequest(
          mediaDeleteSchema,
          collectionUrl(cms.baseUrl, MEDIA, batchWhere(batch, discordMessageId)),
          cms.apiKey,
          { method: "DELETE" },
        );
        return deleted.docs.map(project);
      },
      catch: toCmsError("delete drop images"),
    },
    upstreamRetry,
  );
}

/**
 * Every event the CMS will show us, newest first.
 *
 * Backs the `event` option's autocomplete, so it takes a caller-supplied signal:
 * Discord discards an autocomplete response after three seconds, and a request
 * still running under this module's own fifteen-second timeout is answering
 * nobody.
 *
 * An event without a slug is dropped rather than guessed at — the slug is what a
 * drop is filed under, so a suggestion that cannot be filed is worse than no
 * suggestion.
 */
function listEvents(
  cms: CmsContext,
  signal: AbortSignal,
): Promise<Result<readonly CmsEventSummary[], CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const events: CmsEventSummary[] = [];
        for (let page = 1; page <= EVENT_PAGE_CAP; page += 1) {
          const found = await payloadRequest(
            eventListSchema,
            collectionUrl(cms.baseUrl, EVENTS, {
              limit: String(LIST_PAGE_SIZE),
              page: String(page),
              depth: "0",
              sort: "-start",
            }),
            cms.apiKey,
            { signal },
          );
          for (const doc of found.docs) {
            if (doc.slug === undefined) continue;
            events.push({
              id: doc.id,
              slug: doc.slug,
              name: doc.name ?? doc.slug,
              ...(doc.start !== undefined && { start: doc.start }),
              ...(doc.published !== undefined && { published: doc.published }),
            });
          }
          if (page >= found.totalPages) return events;
        }
        return events;
      },
      catch: toCmsError("list CMS events"),
    },
    { ...upstreamRetry, signal },
  );
}

/** The event with this slug, or `undefined` when the CMS has no such event. */
function findEventBySlug(
  cms: CmsContext,
  slug: string,
): Promise<Result<CmsEvent | undefined, CmsError>> {
  return Result.tryPromise(
    {
      try: async () => {
        const found = await payloadRequest(
          eventListSchema,
          collectionUrl(cms.baseUrl, EVENTS, {
            "where[slug][equals]": slug,
            limit: "1",
            depth: "0",
          }),
          cms.apiKey,
        );
        const doc = found.docs[0];
        if (doc === undefined) return undefined;
        return { id: doc.id, slug: doc.slug ?? slug, name: doc.name ?? slug };
      },
      catch: toCmsError("find CMS event"),
    },
    upstreamRetry,
  );
}

function readEvent(cms: CmsContext, eventId: DocumentId): Promise<EventDoc> {
  return payloadRequest(eventDocSchema, documentUrl(cms.baseUrl, EVENTS, eventId), cms.apiKey);
}

function writeImageRows(
  cms: CmsContext,
  eventId: DocumentId,
  rows: readonly ImageRow[],
): Promise<EventDoc> {
  return payloadRequest(
    eventMutationSchema,
    documentUrl(cms.baseUrl, EVENTS, eventId),
    cms.apiKey,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: rows }),
    },
  ).then((updated) => updated.doc);
}

/**
 * Appends media to the event's gallery, idempotently.
 *
 * Takes a list rather than one id so a backfill costs the same two requests as a
 * single upload does. Returns how many rows it actually added.
 *
 * The verification pass at the end is not belt-and-braces: it is the only signal
 * that a concurrent writer clobbered this append, and raising `Transient` is what
 * makes `upstreamRetry` reapply it against the array that won.
 */
function attachImages(
  cms: CmsContext,
  eventId: DocumentId,
  mediaIds: readonly DocumentId[],
): Promise<Result<number, CmsError>> {
  return Result.tryPromise(
    {
      try: () =>
        serialize(cms.writes, String(eventId), async () => {
          const event = await readEvent(cms, eventId);
          const rows = imageRows(event);
          const missing = mediaIds.filter(
            (mediaId) => !rows.some((entry) => sameId(entry.image, mediaId)),
          );
          if (missing.length === 0) return 0;

          const updated = await writeImageRows(cms, eventId, [
            ...rows,
            ...missing.map((image) => ({ image })),
          ]);
          const present = imageRows(updated);
          if (!missing.every((mediaId) => present.some((entry) => sameId(entry.image, mediaId)))) {
            throw new Transient({
              operation: "attach images to CMS event",
              detail: "the event came back without the images; a concurrent write won",
            });
          }
          return missing.length;
        }),
      catch: toCmsError("attach images to CMS event"),
    },
    upstreamRetry,
  );
}

/**
 * Removes media from an event's gallery.
 *
 * Called before the media itself is deleted, so the event never points at a
 * document that no longer exists.
 */
function detachImages(
  cms: CmsContext,
  eventId: DocumentId,
  removedIds: readonly DocumentId[],
): Promise<Result<number, CmsError>> {
  return Result.tryPromise(
    {
      try: () =>
        serialize(cms.writes, String(eventId), async () => {
          const event = await readEvent(cms, eventId);
          const rows = imageRows(event);
          const kept = rows.filter(
            (entry) => !removedIds.some((removed) => sameId(entry.image, removed)),
          );
          if (kept.length === rows.length) return 0;

          await writeImageRows(cms, eventId, kept);
          return rows.length - kept.length;
        }),
      catch: toCmsError("detach images from CMS event"),
    },
    upstreamRetry,
  );
}

export function createCmsClient(deps: CmsDeps) {
  const cms: CmsContext = { apiKey: deps.apiKey, baseUrl: CMS_URL, writes: new Map() };
  return {
    listImages: (batch: MediaBatch) => listImages(cms, batch),
    uploadImage: (input: UploadImageInput) => uploadImage(cms, input),
    hasImageForMessage: (batch: MediaBatch, discordMessageId: string, filename?: string) =>
      hasImageForMessage(cms, batch, discordMessageId, filename),
    deleteImagesForMessage: (batch: MediaBatch, discordMessageId: string) =>
      deleteImagesForMessage(cms, batch, discordMessageId),
    findEventBySlug: (slug: string) => findEventBySlug(cms, slug),
    listEvents: (signal: AbortSignal) => listEvents(cms, signal),
    attachImages: (eventId: DocumentId, mediaIds: readonly DocumentId[]) =>
      attachImages(cms, eventId, mediaIds),
    detachImages: (eventId: DocumentId, removedIds: readonly DocumentId[]) =>
      detachImages(cms, eventId, removedIds),
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
  images: readonly DropImage[],
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
