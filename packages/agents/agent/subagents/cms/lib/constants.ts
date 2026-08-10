import { z } from "zod";

import { cmsAdminUrl, documentId, type PayloadDocument, relationship } from "./client.ts";

/**
 * Input fields, projections, and wire helpers shared across this domain's tools.
 *
 * Payload exposes nine collections through one REST shape, so every collection
 * needs the same three things: the pagination fields its list tool accepts, the
 * writable fields its create tool requires and its update tool takes a partial
 * of, and the projection that renames Payload's camelCase columns to the
 * snake_case the model reads. Declaring each once keeps a create and its update
 * from drifting apart, which is the failure this domain is most prone to — an
 * update that silently accepts a field the create does not.
 */

/** Shared limit/page/sort input fields — spread into a tool's `z.strictObject({...})`. */
export const paginationInputShape = {
  limit: z
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max documents to return per page (default 25, max 100)"),
  page: z.int().min(1).optional().describe("1-indexed page number (default 1)"),
  sort: z
    .string()
    .optional()
    .describe('Field to sort by. Prefix with "-" for descending (e.g. "-createdAt")'),
};

/**
 * ISO 8601 date-time as Payload's `date` fields accept it: UTC (`…Z`), an explicit
 * offset (`…+05:00`), or a bare local time (`…T18:00:00`).
 */
export const cmsDatetime = z.iso.datetime({ offset: true, local: true });

/** Roles defined in purduehackers/cms src/collections/auth-utils.ts. */
export const cmsRole = z.enum([
  "admin",
  "editor",
  "viewer",
  "hack_night_dashboard",
  "events_website",
  "wack_hacker",
]);

/**
 * Lexical encodes "inherit the parent's text direction" as an explicit JSON
 * `null` on every node. Payload rejects the field when it is missing, so the
 * literal is required on the wire; naming it once keeps the rest of this module
 * under the no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- Payload's Lexical wire format requires an explicit null direction
const INHERIT_DIRECTION = null;

/**
 * Wrap plain text as the minimal Lexical JSON shape Payload's `richText`
 * field expects on writes. Keeps the rendered shape consistent across
 * collections so any future tweak (version bumps, formatting defaults)
 * happens in one place.
 */
export function richTextParagraph(text: string) {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: INHERIT_DIRECTION,
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: INHERIT_DIRECTION,
          children: [
            { type: "text", text, format: 0, detail: 0, mode: "normal", style: "", version: 1 },
          ],
        },
      ],
    },
  };
}

/** Writable event fields. `create_event` requires them; `update_event` takes the partial. */
export const eventFields = {
  name: z.string(),
  start: cmsDatetime.describe("ISO 8601 datetime for event start"),
  end: cmsDatetime.optional().describe("ISO 8601 datetime for event end"),
  event_type: z.string().optional().describe("Event type (default 'hack-night')"),
  location_name: z.string().optional(),
  location_url: z.url().optional(),
  description: z.string().describe("Plain text description"),
  published: z.boolean().optional(),
};

export function projectEvent(e: PayloadDocument<"events">) {
  return {
    id: e.id,
    name: e.name,
    published: e.published,
    event_type: e.eventType,
    start: e.start,
    end: e.end,
    location_name: e.location_name,
    location_url: e.location_url,
    send: e.send,
    sent_at: e.sentAt,
    stats: e.stats,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    href: e.id === undefined ? undefined : cmsAdminUrl("events", e.id),
  };
}

/** Writable RSVP fields. `create_rsvp` requires them; `update_rsvp` takes the partial. */
export const rsvpFields = {
  event_id: documentId,
  email: z.email(),
  name: z.string(),
  unsubscribed: z.boolean().optional(),
};

export function projectRsvp(r: PayloadDocument<"rsvps">) {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    event_id: relationship(r.event).id,
    unsubscribed: r.unsubscribed,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    href: r.id === undefined ? undefined : cmsAdminUrl("rsvps", r.id),
  };
}

/** Writable email fields. `create_email` requires them; `update_email` takes the partial. */
export const emailFields = {
  event_id: documentId,
  subject: z.string(),
  body: z.string().describe("Plain-text or HTML email body"),
};

export function projectEmail(e: PayloadDocument<"emails">) {
  return {
    id: e.id,
    event_id: relationship(e.event).id,
    subject: e.subject,
    body: e.body,
    send: e.send,
    sent_at: e.sentAt,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    href: e.id === undefined ? undefined : cmsAdminUrl("emails", e.id),
  };
}

/** Writable session fields. Create requires them; update takes the partial. */
export const sessionFields = {
  title: z.string(),
  date: cmsDatetime.describe("ISO 8601 datetime"),
  host_preferred_name: z.string(),
  host_discord_id: z.string(),
  description: z.string(),
  published: z.boolean().optional(),
};

export function projectSession(s: PayloadDocument<"hack-night-sessions">) {
  return {
    id: s.id,
    title: s.title,
    date: s.date,
    published: s.published,
    host: s.host,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    href: s.id === undefined ? undefined : cmsAdminUrl("hack-night-sessions", s.id),
  };
}

export function projectMedia(m: PayloadDocument<"media">) {
  return {
    id: m.id,
    alt: m.alt,
    url: m.url,
    thumbnail_url: m.thumbnailURL,
    filename: m.filename,
    mime_type: m.mimeType,
    filesize: m.filesize,
    width: m.width,
    height: m.height,
    batch_id: m.batchId,
    discord_message_id: m.discordMessageId,
    discord_user_id: m.discordUserId,
    source: m.source,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    href: m.id === undefined ? undefined : cmsAdminUrl("media", m.id),
  };
}

/** Writable ugrant fields. Create requires them; update takes the partial. */
export const ugrantFields = {
  name: z.string(),
  author: z.string(),
  description: z.string(),
  image_id: documentId,
  author_url: z.url().optional(),
  project_url: z.url().optional(),
  visible: z.boolean().optional(),
};

export function projectUgrant(u: PayloadDocument<"ugrants">) {
  const image = relationship(u.image);
  return {
    id: u.id,
    visible: u.visible,
    name: u.name,
    author: u.author,
    description: u.description,
    image_id: image.id,
    image_url: image.url,
    author_url: u.authorUrl,
    project_url: u.projectUrl,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
    href: u.id === undefined ? undefined : cmsAdminUrl("ugrants", u.id),
  };
}

/** Writable shelter-project fields. Create requires them; update takes the partial. */
export const shelterProjectFields = {
  name: z.string(),
  last_division: z.string(),
  last_owner: z.string(),
  description: z.string(),
  image_id: documentId,
  visible: z.boolean().optional(),
};

export function projectShelter(s: PayloadDocument<"shelter-projects">) {
  const image = relationship(s.image);
  return {
    id: s.id,
    visible: s.visible,
    name: s.name,
    last_division: s.last_division,
    last_owner: s.last_owner,
    description: s.description,
    image_id: image.id,
    image_url: image.url,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    href: s.id === undefined ? undefined : cmsAdminUrl("shelter-projects", s.id),
  };
}

/** Writable user fields. Create requires them; update takes the partial minus `password`. */
export const userFields = {
  email: z.email(),
  password: z.string().min(8).describe("Initial password (user can change it after login)"),
  roles: z.array(cmsRole).min(1),
};

export function projectUser(u: PayloadDocument<"users">) {
  return {
    id: u.id,
    email: u.email,
    roles: u.roles,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
    href: u.id === undefined ? undefined : cmsAdminUrl("users", u.id),
  };
}

/** Writable service-account fields. Create requires them; update takes the partial. */
export const serviceAccountFields = {
  name: z.string(),
  roles: z.array(cmsRole).min(1),
  revoked: z.boolean().optional(),
};

export function projectServiceAccount(s: PayloadDocument<"service-accounts">) {
  return {
    id: s.id,
    name: s.name,
    revoked: s.revoked,
    roles: s.roles,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    href: s.id === undefined ? undefined : cmsAdminUrl("service-accounts", s.id),
  };
}
