/**
 * Purdue Hackers ID webhooks: verification and decoding.
 *
 * ID signs deliveries the Standard Webhooks way — HMAC-SHA256 over
 * `${webhook-id}.${webhook-timestamp}.${body}`, keyed by the base64 bytes after
 * the `whsec_` prefix, sent as `v1,<base64>`. The signature is checked against
 * the raw body, before anything parses it, so a forged payload never reaches the
 * decoder.
 *
 * ID re-signs every retry with a fresh `webhook-timestamp`, so the replay window
 * only has to cover clock skew and transit, not ID's backoff schedule.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { discordSnowflake } from "../schema.ts";

/** Generous for skew, small enough that a captured request goes stale quickly. */
const TOLERANCE_SECONDS = 5 * 60;

export interface SignedRequest {
  readonly id: string | undefined;
  readonly timestamp: string | undefined;
  readonly signature: string | undefined;
  readonly body: string;
}

function keyOf(secret: string): Buffer {
  return Buffer.from(secret.replace(/^whsec_/u, ""), "base64");
}

/**
 * True when one of the request's `v1` signatures matches.
 *
 * The header may carry several space-separated signatures so a sender can
 * rotate secrets without a gap; any one matching is enough.
 */
export function verifySignature(secret: string, request: SignedRequest, nowMs: number): boolean {
  const { id, timestamp, signature, body } = request;
  if (secret === "" || id === undefined || timestamp === undefined || signature === undefined) {
    return false;
  }
  if (!/^\d+$/u.test(timestamp)) return false;
  if (Math.abs(nowMs / 1_000 - Number.parseInt(timestamp, 10)) > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", keyOf(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  return signature.split(" ").some((entry) => {
    const [version, encoded] = entry.split(",", 2);
    if (version !== "v1" || encoded === undefined) return false;
    const presented = Buffer.from(encoded, "base64");
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  });
}

/**
 * The linked Discord account, as ID reports it under `directory:discord`.
 * `null` means the ID user has no Discord account linked.
 */
const userRef = z.object({
  sub: z.string().min(1),
  discord_id: discordSnowflake.nullable(),
});

const idRole = z.enum(["alumni", "organizer", "admin"]);
export type IdRole = z.output<typeof idRole>;

const envelope = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({ type: z.literal(type), timestamp: z.iso.datetime(), data });

/**
 * The events this receiver acts on. Anything else ID sends — bans, profile
 * updates, the dashboard's test ping — is acknowledged and ignored, so
 * subscribing the endpoint to more events never turns into retries.
 */
export const idWebhookSchema = z.discriminatedUnion("type", [
  envelope(
    "user.roles.changed",
    z.object({ user: userRef, previous_roles: z.array(idRole), roles: z.array(idRole) }),
  ),
  envelope("user.discord.unlinked", z.object({ user: userRef })),
]);
export type IdWebhook = z.output<typeof idWebhookSchema>;

const typeOnly = z.object({ type: z.string() });

export type Decoded =
  | { readonly kind: "event"; readonly event: IdWebhook }
  | { readonly kind: "ignored"; readonly type: string }
  | { readonly kind: "invalid"; readonly issues: string };

export function decodeIdWebhook(body: string): Decoded {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { kind: "invalid", issues: "body is not JSON" };
  }
  const header = typeOnly.safeParse(json);
  if (!header.success) return { kind: "invalid", issues: z.prettifyError(header.error) };
  const known = idWebhookSchema.options.some(
    (option) => option.shape.type.value === header.data.type,
  );
  if (!known) return { kind: "ignored", type: header.data.type };

  const parsed = idWebhookSchema.safeParse(json);
  if (!parsed.success) return { kind: "invalid", issues: z.prettifyError(parsed.error) };
  return { kind: "event", event: parsed.data };
}
