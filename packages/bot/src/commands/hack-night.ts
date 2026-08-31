/**
 * `/hack-night` — set up or reset the weekly hack night.
 *
 * `start` and `reset` are subcommands because they act on the same weekly hack
 * night state.
 *
 * Organizer-gated. The check reads the member's live roles off the interaction,
 * so it reflects the caller's roles right now rather than anything cached.
 *
 * The side effects are deliberately ordered: rename the channel first, bump the
 * dashboard version second. A failed rename leaves the version untouched, which
 * is recoverable by re-running. The reverse order would advertise a hack night
 * the Discord channel does not reflect.
 *
 * `event` links tonight's photo thread to a CMS event, so photos posted in it are
 * attached to that event instead of only being filed under a date-derived batch.
 * Both lookups it needs — the event and the thread — happen *before* the rename,
 * because a slug typo should cost nothing, and linking itself happens last: it
 * is the one step that can be repeated on its own by re-running the command.
 */

import { DISCORD_IDS, UserRole, roleAtLeast } from "@repo/shared/discord";
import { Forbidden, InvalidInput, messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { ChannelType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { AnyThreadChannel, ChatInputCommandInteraction } from "discord.js";

import type { SlashCommand } from "../framework/commands.ts";
import { isEventSlug, isPermissionDenied } from "../integrations/cms.ts";
import type { CmsClient, CmsEvent } from "../integrations/cms.ts";
import type { EventDirectory } from "../integrations/event-directory.ts";
import {
  HACK_NIGHT_THREAD_PREFIX,
  hackNightDrop,
  resolveDrop,
} from "../integrations/image-drop.ts";
import type { ImageDrop, ImageDropStore } from "../integrations/image-drop.ts";
import { fridayOfWeek } from "../utils/dates.ts";
import { roleOf } from "../utils/roles.ts";
import { EVENT_OPTION, eventAutocomplete } from "./event-autocomplete.ts";

/** 🌙 — the channel's resting state between hack nights. */
const DEFAULT_EMOJI = "\u{1F319}";

export type HackNightError = Forbidden | InvalidInput | Transient | UpstreamError;

/**
 * Swaps the leading emoji, leaving the rest of the channel name alone.
 *
 * Only one leading pictographic character is stripped, so a name that never had
 * a prefix simply gains one and repeated runs do not accumulate emoji.
 */
function withEmojiPrefix(currentName: string, emoji: string): string {
  return `${emoji}${currentName.replace(/^\p{Extended_Pictographic}/u, "")}`;
}

/**
 * A single emoji, nothing else.
 *
 * Discord accepts almost anything in a channel name, so an unchecked value here
 * would let a typo rename the busiest channel in the server to arbitrary text.
 */
function isSingleEmoji(value: string): boolean {
  return /^\p{Extended_Pictographic}$/u.test(value);
}

/** Semver-ish, matching the dashboard's own expectation (for example `6.17`). */
function isVersionString(value: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(value);
}

export interface DashboardWriter {
  readonly setVersion: (version: string) => Promise<Result<undefined, HackNightError>>;
}

export interface HackNightDeps {
  readonly dashboard: DashboardWriter;
  readonly cms: CmsClient;
  readonly drops: ImageDropStore;
  readonly directory: EventDirectory;
}

export const builder = new SlashCommandBuilder();
builder
  .setName("hack-night")
  .setDescription("Set up or reset hack night (organizers only)")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start hack night: set the channel emoji and bump the dashboard version")
      .addStringOption((opt) =>
        opt
          .setName("emoji")
          .setDescription("The emoji to use as the channel prefix")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("version")
          .setDescription("The version string shown on the dashboard (e.g. 6.17)")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName(EVENT_OPTION)
          .setDescription("CMS event slug to file tonight's photos under (optional)")
          .setRequired(false)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("reset").setDescription("Reset the channel prefix back to the moon emoji"),
  );

/** Renames the hack night channel, returning the new name. */
async function renameChannel(
  interaction: ChatInputCommandInteraction,
  emoji: string,
): Promise<Result<string, HackNightError>> {
  return Result.tryPromise({
    try: async () => {
      const channel = await interaction.client.channels.fetch(DISCORD_IDS.channels.HACK_NIGHT);
      // A falsy check rather than an explicit null comparison: discord.js
      // reports "no such channel" as null, and a channel object is never falsy.
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        throw new UpstreamError({
          service: "discord",
          status: 404,
          detail: "hack night channel is not a guild text channel",
        });
      }

      const renamed = await channel.setName(withEmojiPrefix(channel.name, emoji));
      return renamed.name;
    },
    catch: (cause) =>
      cause instanceof UpstreamError
        ? cause
        : new Transient({
            operation: "rename hack night channel",
            detail: messageOf(cause),
          }),
  });
}

/**
 * The newest live `Hack Night Images` thread under the hack night channel.
 *
 * Active threads rather than the cleanup job's "first thread-bearing message in
 * the last ten" scan: that heuristic holds on Sunday, when the announcement is
 * still among the most recent messages, but `/hack-night start` runs while the
 * channel is busy.
 */
async function findPhotoThread(
  interaction: ChatInputCommandInteraction,
): Promise<Result<AnyThreadChannel | undefined, HackNightError>> {
  return Result.tryPromise({
    try: async () => {
      const channel = await interaction.client.channels.fetch(DISCORD_IDS.channels.HACK_NIGHT);
      if (channel?.type !== ChannelType.GuildText) {
        throw new UpstreamError({
          service: "discord",
          status: 404,
          detail: "hack night channel is not a guild text channel",
        });
      }

      const active = await channel.threads.fetchActive();
      const candidates = [...active.threads.values()].filter((thread) =>
        thread.name.startsWith(HACK_NIGHT_THREAD_PREFIX),
      );
      // Snowflakes order by creation time, so the largest id is tonight's.
      return candidates.sort((left, right) => (left.id < right.id ? 1 : -1))[0];
    },
    catch: (cause) =>
      cause instanceof UpstreamError
        ? cause
        : new Transient({
            operation: "find hack night photo thread",
            detail: messageOf(cause),
          }),
  });
}

/**
 * What the `event` option resolved to.
 *
 * A rejection is an *answer*, not an error: the dispatcher renders a failed
 * command as "Something went wrong", which cannot tell an organizer that the
 * slug was wrong or that there is no thread to link yet.
 */
interface Linked {
  readonly kind: "linked";
  readonly event: CmsEvent;
  readonly thread: AnyThreadChannel;
}

type LinkOutcome = Linked | { readonly kind: "rejected"; readonly message: string };

/** Resolves the event and the thread. Reads only — nothing here changes anything. */
async function prepareLink(
  interaction: ChatInputCommandInteraction,
  cms: CmsClient,
  slug: string,
): Promise<Result<LinkOutcome, HackNightError>> {
  if (!isEventSlug(slug)) {
    return Result.ok({
      kind: "rejected",
      message: `\`${slug}\` is not an event slug. Slugs are lowercase, like \`hack-night-9-5\`.`,
    });
  }

  const found = await cms.findEventBySlug(slug);
  if (Result.isError(found)) {
    if (!isPermissionDenied(found.error)) return found;
    return Result.ok({
      kind: "rejected",
      message:
        "The CMS will not let me read events. The bot's service account needs the `viewer` " +
        "role before a hack night can be linked to one.",
    });
  }
  if (found.value === undefined) {
    return Result.ok({
      kind: "rejected",
      message: `No CMS event has the slug \`${slug}\`. Check the event's **slug** field in the CMS admin.`,
    });
  }

  const thread = await findPhotoThread(interaction);
  if (Result.isError(thread)) return thread;
  if (thread.value === undefined) {
    return Result.ok({
      kind: "rejected",
      message:
        "There is no open `Hack Night Images` thread to link yet. The Friday 8 PM job opens " +
        "one; start it first, then run this again.",
    });
  }

  return Result.ok({ kind: "linked", event: found.value, thread: thread.value });
}

/**
 * Attaches photos already filed under the drop's batch.
 *
 * A hack night linked after people started posting would otherwise leave the
 * night's first photos in the archive but off the event. One list and one
 * read-modify-write, so it costs the same whether it moves nothing or fifty.
 */
async function backfill(
  deps: HackNightDeps,
  drop: ImageDrop,
  event: CmsEvent,
): Promise<Result<string, HackNightError>> {
  const listed = await deps.cms.listImages(drop);
  if (Result.isError(listed)) return listed;
  if (listed.value.length === 0) return Result.ok("");

  const attached = await deps.cms.attachImages(
    event.id,
    listed.value.map((image) => image.id),
  );
  if (Result.isError(attached)) {
    if (!isPermissionDenied(attached.error)) return attached;
    return Result.ok(
      "The CMS will not let me write the event's gallery, so the photos are filed under the " +
        "batch only — an editor can attach them from the media library.",
    );
  }

  return Result.ok(
    attached.value === 0 ? "" : `Attached ${attached.value} photo(s) already in the thread.`,
  );
}

/**
 * Points tonight's photo thread at a CMS event.
 *
 * The batch is deliberately *not* moved to the event's slug. Photos posted before
 * the link were filed under the night's date-derived batch, and changing it would
 * split the archive in two — Sunday's leaderboard would then count half a night.
 * The link is additive: one batch for the night, plus an event the photos are
 * attached to, including the ones already posted.
 *
 * Returns the line the reply reports it under.
 */
async function link(
  deps: HackNightDeps,
  tonight: Linked | undefined,
): Promise<Result<string, HackNightError>> {
  const fallback = hackNightDrop(fridayOfWeek(new Date()));
  if (tonight === undefined) {
    // Say what the photos are filed under anyway: the date-derived batch is what
    // a human has to search the media library for later.
    return Result.ok(`Photos: batch \`${fallback.batchId}\` (no CMS event linked)`);
  }

  // Whatever the Friday job recorded, plus the event. Reading it back is what
  // keeps the batch stable when the link happens mid-night.
  const current = await resolveDrop(deps.drops, tonight.thread.id, fallback);
  const drop: ImageDrop = { ...current, label: tonight.event.name, event: tonight.event };

  const stored = await deps.drops.set(tonight.thread.id, drop);
  if (Result.isError(stored)) return stored;

  const line = `Photos: <#${tonight.thread.id}> → **${tonight.event.name}** (batch \`${drop.batchId}\`)`;
  const backfilled = await backfill(deps, drop, tonight.event);
  if (Result.isError(backfilled)) return backfilled;

  return Result.ok(backfilled.value === "" ? line : `${line}\n- ${backfilled.value}`);
}

async function run(
  interaction: ChatInputCommandInteraction,
  deps: HackNightDeps,
): Promise<Result<string, HackNightError>> {
  // Live roles from the interaction, never a cached snapshot.
  const role = roleOf(interaction);
  if (!roleAtLeast(role, UserRole.Organizer)) {
    return Result.err(
      new Forbidden({ required: UserRole.Organizer, actual: role, subject: "/hack-night" }),
    );
  }

  if (interaction.options.getSubcommand() === "reset") {
    return Result.map(
      await renameChannel(interaction, DEFAULT_EMOJI),
      (name) => `Hack night reset. Channel is now **${name}**.`,
    );
  }

  const emoji = interaction.options.getString("emoji", true);
  const version = interaction.options.getString("version", true);
  const slug = interaction.options.getString(EVENT_OPTION)?.trim().toLowerCase();

  if (!isSingleEmoji(emoji)) {
    return Result.err(
      new InvalidInput({ subject: "emoji", issues: [`"${emoji}" is not a single emoji`] }),
    );
  }
  if (!isVersionString(version)) {
    return Result.err(
      new InvalidInput({ subject: "version", issues: [`"${version}" is not like 6.17`] }),
    );
  }

  // Before the rename, so an unusable `event` option aborts the whole command
  // rather than half-starting a hack night the organizer has to unpick.
  let tonight: Linked | undefined;
  if (slug !== undefined && slug !== "") {
    const prepared = await prepareLink(interaction, deps.cms, slug);
    if (Result.isError(prepared)) return prepared;
    if (prepared.value.kind === "rejected") return Result.ok(prepared.value.message);
    tonight = prepared.value;
  }

  const renamed = await renameChannel(interaction, emoji);
  if (Result.isError(renamed)) return renamed;

  // Second, so a failed rename never advertises a hack night the channel does
  // not reflect. Re-running the command is safe.
  const bumped = await deps.dashboard.setVersion(version);
  if (Result.isError(bumped)) return bumped;

  const linked = await link(deps, tonight);
  if (Result.isError(linked)) return linked;

  return Result.ok(
    `Hack night started.\n- Channel: **${renamed.value}**\n- Version: **${version}**\n- ${linked.value}`,
  );
}

export function hackNightCommand(deps: HackNightDeps) {
  return {
    builder,
    autocomplete: eventAutocomplete(deps.directory),
    execute: async (interaction) => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const outcome = await run(interaction, deps);
      if (Result.isError(outcome)) return Result.err(outcome.error);

      await interaction.editReply(outcome.value);
      return Result.ok(undefined);
    },
  } satisfies SlashCommand;
}
