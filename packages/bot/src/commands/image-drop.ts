/**
 * `/image-drop` — open a thread whose images are filed to a CMS event.
 *
 * Organizer-gated, because it commits the bot to publishing whatever lands in
 * the thread: every image posted there is uploaded to the public CMS archive.
 * *Posting* into the drop is open to anyone — the gate is on opening one.
 *
 * The order is: read the CMS, then write Discord, then record the drop. The read
 * is first so a mistyped slug costs nothing; the record is last because a thread
 * has to exist before anything can be filed against it. That leaves one bad
 * outcome — a thread with no record, which would ignore every upload — so the
 * command deletes the thread it just made rather than leaving one that silently
 * swallows photos.
 */

import { UserRole, roleAtLeast } from "@repo/shared/discord";
import { Forbidden, messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
} from "discord.js";
import type { ChatInputCommandInteraction, SendableChannels } from "discord.js";

import type { SlashCommand } from "../framework/commands.ts";
import { isEventSlug, isPermissionDenied, MediaSource } from "../integrations/cms.ts";
import type { CmsClient, CmsEvent } from "../integrations/cms.ts";
import type { ImageDropStore } from "../integrations/image-drop.ts";
import { roleOf } from "../utils/roles.ts";

export type ImageDropError = Forbidden | Transient | UpstreamError;

/** Discord's cap on a thread name. */
const THREAD_NAME_LIMIT = 100;
const THREAD_NAME_PREFIX = "Image Drop — ";

/** The thread only needs to outlive the stragglers still posting photos. */
const THREAD_ARCHIVE_DURATION = ThreadAutoArchiveDuration.OneWeek;

export const builder = new SlashCommandBuilder();
builder
  .setName("image-drop")
  .setDescription("Open a thread whose images are filed to a CMS event (organizers only)")
  .addStringOption((opt) =>
    opt
      .setName("event")
      .setDescription("The event's slug in the CMS (e.g. sound-galaxy-workshop)")
      .setRequired(true)
      .setMaxLength(THREAD_NAME_LIMIT),
  );

function threadNameFor(event: CmsEvent): string {
  const room = THREAD_NAME_LIMIT - THREAD_NAME_PREFIX.length;
  return `${THREAD_NAME_PREFIX}${event.name.slice(0, room)}`;
}

/**
 * The channel to open the drop in.
 *
 * A thread cannot hold another thread, and a forum post is a thread, so both
 * arrive here as "not a place a drop can go" rather than as a Discord error
 * after the announcement has already been sent.
 */
function dropChannelOf(interaction: ChatInputCommandInteraction): SendableChannels | undefined {
  const { channel } = interaction;
  if (channel === null) return undefined;
  if (channel.isDMBased() || channel.isThread() || !channel.isSendable()) return undefined;
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return undefined;
  }
  return channel;
}

async function openDrop(
  channel: SendableChannels,
  drops: ImageDropStore,
  event: CmsEvent,
): Promise<Result<string, ImageDropError>> {
  return Result.tryPromise({
    try: async () => {
      const announcement = await channel.send(
        `\u{1F4F8} **Image drop: ${event.name}**\n\n` +
          "Post your photos in this thread and I'll add them to the event. " +
          "React ❌ on your own post to take one back out.",
      );

      const thread = await announcement.startThread({
        name: threadNameFor(event),
        autoArchiveDuration: THREAD_ARCHIVE_DURATION,
      });

      const stored = await drops.set(thread.id, {
        batchId: event.slug,
        source: MediaSource.Drop,
        label: event.name,
        event,
      });
      if (Result.isError(stored)) {
        // A thread with no record ignores every upload, which looks exactly like
        // a working drop until someone checks the CMS. Undo both writes so the
        // organizer can simply run the command again.
        await thread.delete().catch(() => undefined);
        await announcement.delete().catch(() => undefined);
        throw stored.error;
      }

      return `Image drop open in <#${thread.id}> — uploads are filed to **${event.name}** (\`${event.slug}\`).`;
    },
    catch: (cause) =>
      cause instanceof Transient
        ? cause
        : new Transient({ operation: "open image drop", detail: messageOf(cause) }),
  });
}

async function run(
  interaction: ChatInputCommandInteraction,
  deps: { readonly cms: CmsClient; readonly drops: ImageDropStore },
): Promise<Result<string, ImageDropError>> {
  // Live roles from the interaction, never a cached snapshot.
  const role = roleOf(interaction);
  if (!roleAtLeast(role, UserRole.Organizer)) {
    return Result.err(
      new Forbidden({ required: UserRole.Organizer, actual: role, subject: "/image-drop" }),
    );
  }

  const slug = interaction.options.getString("event", true).trim().toLowerCase();
  // Rejections below are *answers*, not errors: the dispatcher renders a failed
  // command as "Something went wrong", which cannot tell an organizer that the
  // slug was wrong or that they ran it in a thread.
  if (!isEventSlug(slug)) {
    return Result.ok(
      `\`${slug}\` is not an event slug. Slugs are lowercase, like \`sound-galaxy-workshop\`.`,
    );
  }

  const channel = dropChannelOf(interaction);
  if (channel === undefined) {
    return Result.ok("Run this in a regular text channel — a drop thread cannot live in a thread.");
  }

  const found = await deps.cms.findEventBySlug(slug);
  if (Result.isError(found)) {
    if (!isPermissionDenied(found.error)) return found;
    return Result.ok(
      "The CMS will not let me read events. The bot's service account needs the `viewer` role " +
        "before a drop can be linked to one.",
    );
  }
  if (found.value === undefined) {
    return Result.ok(
      `No CMS event has the slug \`${slug}\`. Check the event's **slug** field in the CMS admin.`,
    );
  }

  return openDrop(channel, deps.drops, found.value);
}

export function imageDropCommand(deps: {
  readonly cms: CmsClient;
  readonly drops: ImageDropStore;
}) {
  return {
    builder,
    execute: async (interaction) => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const outcome = await run(interaction, deps);
      if (Result.isError(outcome)) return Result.err(outcome.error);

      await interaction.editReply(outcome.value);
      return Result.ok(undefined);
    },
  } satisfies SlashCommand;
}
