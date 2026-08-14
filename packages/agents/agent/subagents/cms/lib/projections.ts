/**
 * @fileoverview Projections and rich-text wire helpers shared across this
 * domain's tools.
 *
 * Each collection gets one projection that renames Payload's camelCase
 * columns to the snake_case the model reads. Declaring each once keeps a
 * `get_*` and its `list_*` from drifting apart. The Lexical rich-text wrapper
 * lives beside them for the same reason: `create_*` and `update_*` must
 * serialize plain text identically.
 */

import { cmsAdminUrl, type PayloadDocument, relationship } from "./client.ts";

/**
 * Lexical encodes "inherit the parent's text direction" as an explicit JSON
 * `null` on every node. Payload rejects the field when it is missing, so the
 * wire must carry the literal. Naming it once keeps the rest of this module
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

/**
 * An event as the model reads it: snake_case columns and an admin `href`
 * when the document has an id.
 */
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

/**
 * An RSVP as the model reads it. The `event` relationship flattens to a bare
 * `event_id`, whichever shape Payload returned it in.
 */
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

/**
 * An email as the model reads it: the flattened `event_id`, the send state,
 * and an admin `href` when the document has an id.
 */
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

/**
 * A hack-night session as the model reads it: snake_case columns and `host`
 * as Payload stores it. The admin `href` needs an id.
 */
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

/**
 * A media document as the model reads it: snake_case file metadata plus the
 * Discord columns. The admin `href` appears only when the document has an id.
 */
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

/**
 * A ugrant as the model reads it. The `image` relationship resolves to
 * `image_id` plus `image_url` so the model never handles a populated document.
 */
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

/**
 * A shelter project as the model reads it: snake_case columns plus the
 * resolved image id and url. The admin `href` needs an id.
 */
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

/**
 * A user as the model reads it: email and roles, the shared timestamps, and
 * an admin `href`. The `password` never comes back through this projection.
 */
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

/**
 * A service account as the model reads it: name, roles, and `revoked`, so a
 * dead credential is visible without a separate lookup.
 */
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
