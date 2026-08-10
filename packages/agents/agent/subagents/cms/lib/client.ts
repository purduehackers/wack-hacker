import { z } from "zod";

import { env } from "../../../env.ts";

const CMS_WEB_ORIGIN = "https://cms.purduehackers.com";
const CMS_AUTH_COLLECTION = "service-accounts";
const REQUEST_TIMEOUT_MS = 15_000;

/** Payload assigns numeric ids on Postgres and string ids on Mongo; both reach us on the wire. */
export const documentId = z.union([z.string(), z.number()]);

type DocumentId = z.output<typeof documentId>;

const eventSchema = z.object({
  id: documentId.optional(),
  name: z.string().optional(),
  published: z.boolean().optional(),
  eventType: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  location_name: z.string().optional(),
  location_url: z.string().optional(),
  description: z.unknown().optional(),
  send: z.boolean().optional(),
  sentAt: z.string().optional(),
  stats: z
    .array(z.object({ data: z.string().optional(), label: z.string().optional() }))
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const rsvpSchema = z.object({
  id: documentId.optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  event: z.union([documentId, z.object({ id: documentId.optional() })]).optional(),
  unsubscribed: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const emailSchema = z.object({
  id: documentId.optional(),
  event: z.union([documentId, z.object({ id: documentId.optional() })]).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  send: z.boolean().optional(),
  sentAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const hackNightSessionSchema = z.object({
  id: documentId.optional(),
  title: z.string().optional(),
  date: z.string().optional(),
  published: z.boolean().optional(),
  host: z
    .object({ preferred_name: z.string().optional(), discord_id: z.string().optional() })
    .optional(),
  description: z.unknown().optional(),
  images: z.array(z.object({ image: z.unknown().optional() })).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const mediaSchema = z.object({
  id: documentId.optional(),
  alt: z.string().optional(),
  url: z.string().optional(),
  thumbnailURL: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  filesize: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  batchId: z.string().optional(),
  discordMessageId: z.string().optional(),
  discordUserId: z.string().optional(),
  source: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const ugrantSchema = z.object({
  id: documentId.optional(),
  visible: z.boolean().optional(),
  name: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  image: z
    .union([documentId, z.object({ id: documentId.optional(), url: z.string().optional() })])
    .optional(),
  authorUrl: z.string().optional(),
  projectUrl: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const shelterProjectSchema = z.object({
  id: documentId.optional(),
  visible: z.boolean().optional(),
  name: z.string().optional(),
  last_division: z.string().optional(),
  last_owner: z.string().optional(),
  description: z.string().optional(),
  image: z
    .union([documentId, z.object({ id: documentId.optional(), url: z.string().optional() })])
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const userSchema = z.object({
  id: documentId.optional(),
  email: z.string().optional(),
  roles: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const serviceAccountSchema = z.object({
  id: documentId.optional(),
  name: z.string().optional(),
  revoked: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const payloadDocumentSchemas = {
  events: eventSchema,
  rsvps: rsvpSchema,
  emails: emailSchema,
  "hack-night-sessions": hackNightSessionSchema,
  media: mediaSchema,
  ugrants: ugrantSchema,
  "shelter-projects": shelterProjectSchema,
  users: userSchema,
  "service-accounts": serviceAccountSchema,
} as const;

type PayloadCollection = keyof typeof payloadDocumentSchemas;
export type PayloadDocument<C extends PayloadCollection> = z.output<
  (typeof payloadDocumentSchemas)[C]
>;
const payloadPaginationSchema = z.object({
  totalDocs: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
  page: z.int().positive().nullable(),
});
const payloadMutationEnvelopeSchema = z.object({ doc: z.unknown() });
type PayloadPage<C extends PayloadCollection> = z.output<typeof payloadPaginationSchema> & {
  readonly docs: PayloadDocument<C>[];
};

/**
 * A Payload relationship arrives either as a bare id or as the populated document,
 * depending on the collection's `depth`. Both shapes project to the same pair.
 */
const relationshipSchema = z.union([
  z.object({ id: documentId.optional(), url: z.string().optional() }),
  documentId.transform((id) => ({ id, url: undefined })),
]);

/** Read `{ id, url }` off a relationship field without caring which shape came back. */
export function relationship(value: unknown): {
  id?: DocumentId | undefined;
  url?: string | undefined;
} {
  return relationshipSchema.safeParse(value).data ?? {};
}

/** Payload's `where[field][equals]` filter: scalar predicates stringified into the query. */
type Where = Readonly<Record<string, { readonly equals: boolean | number | string }>>;

/** Write-only inputs Payload accepts that never appear on a read projection. */
interface PayloadWriteOnlyFields {
  readonly users: { readonly password?: string | undefined };
}

/** Body accepted by a create/update on a collection: its document fields plus write-only inputs. */
type PayloadWriteData<C extends PayloadCollection> = Partial<PayloadDocument<C>> &
  (C extends keyof PayloadWriteOnlyFields ? PayloadWriteOnlyFields[C] : unknown);

interface PayloadFindOptions<C extends PayloadCollection = PayloadCollection> {
  readonly collection: C;
  readonly limit?: number;
  readonly page?: number;
  readonly sort?: string;
  readonly where?: Where;
}

interface PayloadMutationOptions<C extends PayloadCollection = PayloadCollection> {
  readonly collection: C;
  readonly id?: DocumentId;
  readonly data?: PayloadWriteData<C>;
  readonly file?: File;
}

class PayloadCmsError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`Payload CMS ${status}: ${detail}`);
    this.name = "PayloadCmsError";
    this.status = status;
  }
}

/** Decodes a JSON document, reporting malformed text as an issue instead of throwing. */
const jsonText = z.string().transform((value, ctx): unknown => {
  try {
    return JSON.parse(value);
  } catch (cause) {
    ctx.issues.push({
      code: "invalid_format",
      format: "json",
      input: value,
      message: cause instanceof Error ? cause.message : "response body was not JSON",
    });
    return z.NEVER;
  }
});

const errorBodySchema = jsonText.pipe(
  z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ message: z.string().optional() })).optional(),
  }),
);

function responseDetail(body: string, fallback: string): string {
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) {
    return parsed.data.errors?.[0]?.message ?? parsed.data.message ?? fallback;
  }
  // The bounded response text is still safe to surface.
  return body.slice(0, 500) || fallback;
}

function schemaFailure(error: z.ZodError): PayloadCmsError {
  return new PayloadCmsError(502, `invalid response: ${z.prettifyError(error)}`);
}

function documentSchema<C extends PayloadCollection>(
  collection: C,
): (typeof payloadDocumentSchemas)[C] {
  return payloadDocumentSchemas[collection];
}

function collectionUrl(baseUrl: string, collection: PayloadCollection, id?: DocumentId): URL {
  const path =
    id === undefined
      ? `/api/${encodeURIComponent(collection)}`
      : `/api/${encodeURIComponent(collection)}/${encodeURIComponent(String(id))}`;
  return new URL(path, baseUrl);
}

function appendQuery(url: URL, input: Omit<PayloadFindOptions, "collection">): void {
  if (input.limit !== undefined) url.searchParams.set("limit", String(input.limit));
  if (input.page !== undefined) url.searchParams.set("page", String(input.page));
  if (input.sort !== undefined) url.searchParams.set("sort", input.sort);
  if (input.where === undefined) return;
  for (const [field, predicate] of Object.entries(input.where)) {
    url.searchParams.set(`where[${field}][equals]`, String(predicate.equals));
  }
}

async function validatedJson<S extends z.ZodType>(
  response: Response,
  schema: S,
): Promise<z.output<S>> {
  const body = await response.text();
  if (!response.ok) {
    throw new PayloadCmsError(response.status, responseDetail(body, response.statusText));
  }
  const parsed = jsonText.pipe(schema).safeParse(body);
  if (!parsed.success) throw schemaFailure(parsed.error);
  return parsed.data;
}

interface PayloadRestClientOptions {
  readonly apiKey: () => string | undefined;
}

function authorizedRequest(options: PayloadRestClientOptions) {
  const requestFetch = globalThis.fetch;
  return async <S extends z.ZodType>(
    url: URL,
    schema: S,
    init: RequestInit = {},
  ): Promise<z.output<S>> => {
    const apiKey = options.apiKey();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new PayloadCmsError(401, "PAYLOAD_CMS_API_KEY is not configured");
    }
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `${CMS_AUTH_COLLECTION} API-Key ${apiKey}`);
    return await validatedJson(
      await requestFetch(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
      schema,
    );
  };
}

/** Minimal Payload REST client: service-account auth, bounded fetches, and Zod-validated responses. */
function createPayloadRestClient(options: PayloadRestClientOptions) {
  const baseUrl = CMS_WEB_ORIGIN;
  const request = authorizedRequest(options);

  async function mutation<S extends z.ZodType>(
    operation: PayloadMutationOptions,
    schema: S,
    method: "POST" | "PATCH" | "DELETE",
  ): Promise<z.output<S>> {
    let body: RequestInit["body"];
    let headers: RequestInit["headers"];
    if (operation.file !== undefined) {
      const form = new FormData();
      form.append("file", operation.file);
      form.append("_payload", JSON.stringify(operation.data ?? {}));
      body = form;
    } else if (method !== "DELETE" || operation.data !== undefined) {
      body = JSON.stringify(operation.data ?? {});
      headers = { "Content-Type": "application/json" };
    }
    const result = await request(
      collectionUrl(baseUrl, operation.collection, operation.id),
      payloadMutationEnvelopeSchema,
      {
        method,
        ...(body === undefined ? {} : { body }),
        ...(headers === undefined ? {} : { headers }),
      },
    );
    const parsed = schema.safeParse(result.doc);
    if (!parsed.success) throw schemaFailure(parsed.error);
    return parsed.data;
  }

  async function findByID<C extends PayloadCollection>(operation: {
    readonly collection: C;
    readonly id: DocumentId;
  }): Promise<PayloadDocument<C>>;
  async function findByID(operation: {
    readonly collection: PayloadCollection;
    readonly id: DocumentId;
  }): Promise<PayloadDocument<PayloadCollection>> {
    return await request(
      collectionUrl(baseUrl, operation.collection, operation.id),
      documentSchema(operation.collection),
    );
  }

  async function create<C extends PayloadCollection>(
    operation: PayloadMutationOptions<C>,
  ): Promise<PayloadDocument<C>>;
  async function create(
    operation: PayloadMutationOptions,
  ): Promise<PayloadDocument<PayloadCollection>> {
    return await mutation(operation, documentSchema(operation.collection), "POST");
  }

  async function update<C extends PayloadCollection>(
    operation: PayloadMutationOptions<C> & { readonly id: DocumentId },
  ): Promise<PayloadDocument<C>>;
  async function update(
    operation: PayloadMutationOptions & { readonly id: DocumentId },
  ): Promise<PayloadDocument<PayloadCollection>> {
    return await mutation(operation, documentSchema(operation.collection), "PATCH");
  }

  async function deleteDocument<C extends PayloadCollection>(
    operation: PayloadMutationOptions<C> & { readonly id: DocumentId },
  ): Promise<PayloadDocument<C>>;
  async function deleteDocument(
    operation: PayloadMutationOptions & { readonly id: DocumentId },
  ): Promise<PayloadDocument<PayloadCollection>> {
    return await mutation(operation, documentSchema(operation.collection), "DELETE");
  }

  return {
    async find<C extends PayloadCollection>(
      operation: PayloadFindOptions<C>,
    ): Promise<PayloadPage<C>> {
      const { collection, ...query } = operation;
      const url = collectionUrl(baseUrl, collection);
      appendQuery(url, query);
      const schema = z.object({
        ...payloadPaginationSchema.shape,
        docs: z.array(documentSchema(collection)),
      });
      return await request(url, schema);
    },
    findByID,
    create,
    update,
    delete: deleteDocument,
  };
}

export const payload = createPayloadRestClient({ apiKey: () => env.PAYLOAD_CMS_API_KEY });

/** Build a link to the Payload admin UI for a single document. */
export function cmsAdminUrl(slug: string, id: DocumentId): string {
  return `${CMS_WEB_ORIGIN}/admin/collections/${slug}/${id}`;
}

/** Resolve pagination input to REST-ready args with defaults. */
export function paginationQuery(input: {
  limit?: number | undefined;
  page?: number | undefined;
  sort?: string | undefined;
}): {
  limit: number;
  page: number;
  sort?: string;
} {
  return {
    limit: input.limit ?? 25,
    page: input.page ?? 1,
    ...(input.sort ? { sort: input.sort } : {}),
  };
}

export function wrapPayloadError(error: unknown): Error {
  if (error instanceof PayloadCmsError) {
    if (error.status === 401) {
      return new PayloadCmsError(401, "check PAYLOAD_CMS_API_KEY");
    }
    if (error.status === 404) {
      return new PayloadCmsError(404, `${error.message} — check id/slug.`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}
