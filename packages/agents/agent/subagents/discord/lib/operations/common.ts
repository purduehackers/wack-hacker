/**
 * Primitives shared by every Discord operations module.
 *
 * The input schemas, the managed-guild scope guard and the image fetcher are
 * properties of Discord's wire format rather than of any one endpoint family, so
 * they live here instead of being restated per module. Each definition is the
 * one that was previously copied verbatim into the modules below.
 */

import type { REST } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import { discordSnowflake } from "@repo/shared/formats";
import {
  ChannelType,
  Routes,
  ThreadAutoArchiveDuration,
  type RESTAPIGuildChannelResolvable,
} from "discord-api-types/v10";
import { z } from "zod";

import { discordObject, malformedDiscordResponse } from "../rest.ts";

// ──────────────── input primitives (mirrors of the wire schemas) ────────────────

/**
 * The one snowflake format, declared in `@repo/shared` because the bot writes
 * the ids these operations read. Re-exported under the local name so the ~45
 * call sites below keep reading as Discord wire primitives.
 */
export { discordSnowflake as discordSnowflakeSchema };

export const reason = z.string().trim().min(1).max(512);
/**
 * `protocol` carries the http(s) restriction, and `abort` stops the chain there
 * so the credential refinement below only ever sees a string `new URL` parses.
 *
 * Narrower than the string-plus-refine form it replaces in one respect: because
 * this pattern is zod's own `httpProtocol`, zod additionally requires a literal
 * `://`. The scheme-only spellings `http:example.com` and `https:/path` used to
 * be accepted and are now rejected. Both are model-authored tool inputs, so the
 * stricter shape is the useful one; nothing else in the accept set moves.
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
 * loosely typed, and Discord signals absence with `null`/`undefined` rather than
 * an empty value, so a summarizer narrows with these instead of a `typeof`.
 */
export const responseString = z.string().min(1);
export const responseInt = z.int();

export const empty = z.strictObject({});
export const channelId = discordSnowflake.describe("Channel ID");
export const memberId = discordSnowflake.describe("Discord user ID");
export const roleId = discordSnowflake.describe("Role ID");

// ──────────────── Discord enum tables ────────────────

const CHANNEL_TYPE_NAMES: Readonly<Record<number, string>> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildAnnouncement]: "announcement",
  [ChannelType.AnnouncementThread]: "announcement_thread",
  [ChannelType.PublicThread]: "public_thread",
  [ChannelType.PrivateThread]: "private_thread",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildForum]: "forum",
};
export const AUTO_ARCHIVE_DURATIONS = {
  "60": ThreadAutoArchiveDuration.OneHour,
  "1440": ThreadAutoArchiveDuration.OneDay,
  "4320": ThreadAutoArchiveDuration.ThreeDays,
  "10080": ThreadAutoArchiveDuration.OneWeek,
} as const;

// ──────────────── projection helpers ────────────────

export function channelType(value: number): string {
  const parsed = responseInt.safeParse(value);
  if (!parsed.success) throw malformedDiscordResponse("channel type");
  return CHANNEL_TYPE_NAMES[parsed.data] ?? `unknown(${parsed.data})`;
}

export type GuildChannelResult = RESTAPIGuildChannelResolvable;

/** Every channel touched by these tools must belong to the single managed guild. */
export async function guildChannel(rest: REST, id: string): Promise<GuildChannelResult> {
  const channel = discordObject<GuildChannelResult>(
    await rest.get(Routes.channel(id)),
    "get channel",
  );
  if (channel.guild_id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "Discord",
      status: 403,
      detail: "channel is outside the managed guild",
    });
  }
  return channel;
}

// ──────────────── image sourcing ────────────────

const IMAGE_TIMEOUT_MS = 15_000;

export async function download(url: string, maxBytes: number, accepted: readonly string[]) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new UpstreamError({
      service: "image-source",
      status: response.status,
      detail: "image could not be fetched",
    });
  }
  const contentType =
    (response.headers.get("content-type") ?? "application/octet-stream").split(";", 1)[0] ?? "";
  if (!accepted.includes(contentType)) {
    throw new UpstreamError({
      service: "image-source",
      status: 415,
      detail: `unsupported content type ${contentType}`,
    });
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UpstreamError({
      service: "image-source",
      status: 413,
      detail: "image exceeds the size limit",
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new UpstreamError({
      service: "image-source",
      status: 413,
      detail: "image exceeds the size limit",
    });
  }
  return { bytes, contentType };
}

export async function imageDataUri(url: string, maxBytes = 256 * 1_024): Promise<string> {
  const image = await download(url, maxBytes, [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ]);
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}
