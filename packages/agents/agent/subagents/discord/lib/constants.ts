/**
 * @fileoverview Input fields and enum tables shared across this domain's
 * tools.
 *
 * Discord's wire format is the same in every endpoint family. A snowflake is a
 * snowflake whether it names a channel, a role or a message. This module
 * therefore declares the primitives once rather than restating them per tool.
 * The response projections built on these primitives live in
 * `./projections.ts`.
 */

import { discordSnowflake } from "@repo/shared/formats";
import { AutoModerationRuleEventType, ThreadAutoArchiveDuration } from "discord-api-types/v10";
import { z } from "zod";

// ──────────────── input primitives (mirrors of the wire schemas) ────────────────

/**
 * The one snowflake format, declared in `@repo/shared` because the bot writes
 * the ids these operations read. Re-exported under the local name so the ~45
 * call sites keep reading as Discord wire primitives.
 */
export { discordSnowflake as discordSnowflakeSchema };

export const reason = z.string().trim().min(1).max(512);
/**
 * `protocol` carries the http(s) restriction, and `abort` stops the chain there
 * so the credential refinement below only ever sees a string `new URL` parses.
 *
 * Narrower than the string-plus-refine form it replaces in one respect: because
 * this pattern is zod's own `httpProtocol`, zod additionally requires a literal
 * `://`. The old form accepted the scheme-only spellings `http:example.com`
 * and `https:/path`. This one rejects them. Both are model-authored tool
 * inputs, so the stricter shape is the useful one. Nothing else in the accept
 * set moves.
 */
export const httpUrl = z
  .url({ protocol: /^https?$/u, abort: true })
  .max(2_048)
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.username === "" && parsed.password === "";
  }, "expected an HTTP(S) URL without embedded credentials");
export const slowmode = z.int().min(0).max(21_600);
export const autoArchiveDuration = z.enum(["60", "1440", "4320", "10080"]);

/**
 * Response-projection primitives. The v10 result types leave many fields
 * loosely typed. Discord signals absence with `null`/`undefined` rather than
 * an empty value, so a summarizer narrows with these instead of a `typeof`.
 */
export const responseString = z.string().min(1);
export const responseInt = z.int();

export const empty = z.strictObject({});
export const channelId = discordSnowflake.describe("Channel ID");
export const memberId = discordSnowflake.describe("Discord user ID");
export const messageId = discordSnowflake.describe("Message ID");
export const roleId = discordSnowflake.describe("Role ID");

export const channelName = z.string().trim().min(1).max(100);
export const hexColor = z.stringFormat("hex-color", /^#[0-9A-F]{6}$/iu);
export const isoDateTime = z.iso.datetime({ offset: true });

/** Discord rejects any other character in a custom emoji's name. */
export const emojiName = z
  .stringFormat("discord-emoji-name", /^[A-Za-z0-9_]+$/u)
  .min(2)
  .max(32);

// ──────────────── Discord enum tables ────────────────

export const AUTO_ARCHIVE_DURATIONS = {
  "60": ThreadAutoArchiveDuration.OneHour,
  "1440": ThreadAutoArchiveDuration.OneDay,
  "4320": ThreadAutoArchiveDuration.ThreeDays,
  "10080": ThreadAutoArchiveDuration.OneWeek,
} as const;
export const AUTO_MOD_EVENT_TYPES = {
  1: AutoModerationRuleEventType.MessageSend,
  2: AutoModerationRuleEventType.MemberUpdate,
} as const;

// ──────────────── auto-moderation input shapes ────────────────

export const autoModMetadataSchema = z.strictObject({
  keyword_filter: z.array(z.string().min(1).max(60)).max(1_000).optional(),
  regex_patterns: z.array(z.string().min(1).max(260)).max(10).optional(),
  presets: z
    .array(z.literal([1, 2, 3]))
    .max(3)
    .optional(),
  allow_list: z.array(z.string().min(1).max(60)).max(100).optional(),
  mention_total_limit: z.int().min(1).max(50).optional(),
  mention_raid_protection_enabled: z.boolean().optional(),
});
const autoModCustomMessage = z.string().trim().min(1).max(150);
/**
 * Discord couples an auto-mod action's metadata to its type: only an alert
 * (type 2) carries a channel, only a timeout (type 3) carries a duration. The
 * discriminated union states that directly, so the model sees three concrete
 * shapes rather than one loose object with four cross-field rules attached.
 */
export const autoModActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal([1, 4]),
    metadata: z.strictObject({ custom_message: autoModCustomMessage.optional() }).optional(),
  }),
  z.strictObject({
    type: z.literal(2),
    metadata: z.strictObject({
      channel_id: discordSnowflake,
      custom_message: autoModCustomMessage.optional(),
    }),
  }),
  z.strictObject({
    type: z.literal(3),
    metadata: z.strictObject({
      duration_seconds: z.int().min(1).max(2_419_200),
      custom_message: autoModCustomMessage.optional(),
    }),
  }),
]);

// ──────────────── image sourcing limits ────────────────

export const EVENT_IMAGE_MAX_BYTES = 8 * 1_024 * 1_024;
