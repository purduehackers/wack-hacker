/**
 * Named string formats shared by the wire contract and the durable records
 * either side writes.
 *
 * Each is a `z.stringFormat` rather than a bare `.regex()`, for two reasons.
 * A rejection names the domain concept — `invalid discord-snowflake` — instead
 * of echoing an anonymous pattern at whoever has to fix the payload. And the
 * same declaration backs both a schema field and a standalone membership test
 * (`discordSnowflake.safeParse(value).success`). A hand-written `typeof` +
 * `.test()` pair can therefore no longer drift away from the schema it
 * duplicates.
 *
 * The patterns stay byte-for-byte as they were. Several of these *look* like a
 * built-in (`z.nanoid`, `z.hash("sha256")`) but differ in length or
 * case-sensitivity. Substituting the built-in would silently change what the
 * durable records accept.
 */

import { z } from "zod";

/** Discord snowflakes are numeric strings. Bounds keep obvious junk out. */
export const discordSnowflake = z.stringFormat("discord-snowflake", /^\d{17,20}$/u);

/** W3C trace context persisted through the durable Redis handoff. */
export const traceparent = z.stringFormat(
  "w3c-traceparent",
  /^(?!ff)[0-9a-f]{2}-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/u,
);

/**
 * A 22-character base64url identifier the agent mints by truncating a sha256:
 * schedule occurrences and authorization affordances both use this shape. Not
 * `z.nanoid()`, which is 21 characters.
 */
export const shortId = z.stringFormat("short-id", /^[A-Za-z0-9_-]{22}$/u);

/** 16-character base64url digest of one rendered Discord message body. */
export const contentHash = z.stringFormat("content-hash", /^[A-Za-z0-9_-]{16}$/u);

/**
 * A container reference pinned to an immutable digest. A mutable tag carries
 * no digest, so this format rejects it. Lowercase hex only, so not
 * `z.hash("sha256")`, which accepts either case.
 */
export const digestPinnedImage = z.stringFormat("digest-pinned-image", /@sha256:[a-f0-9]{64}$/u);

/** The release pipeline's own registry, spelled out in full for CLI arguments. */
export const vcrDigestImage = z.stringFormat(
  "vcr-digest-image",
  /^vcr\.vercel\.com\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u,
);
