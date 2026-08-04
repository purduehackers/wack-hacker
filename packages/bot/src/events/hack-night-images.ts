/**
 * The hack night photo thread.
 *
 * Images posted in a `Hack Night Images` thread are filed to the CMS under the
 * event slug, which is what the Sunday cleanup counts and ranks. Two handlers:
 * the upload, and an ❌ reaction that takes a photo back out again.
 *
 * The ✅ / ❌ reactions are the whole feedback mechanism — uploading happens in
 * the background and a photo that silently failed to file would only be noticed
 * when it was missing from the leaderboard.
 */

import { DISCORD_IDS, UserRole, roleAtLeast, roleFromMemberRoles } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import type { CmsClient } from "../integrations/cms.ts";
import { resolveEventSlug } from "../integrations/hack-night.ts";
import type { ThreadSlugStore } from "../integrations/hack-night.ts";

const THREAD_NAME_PREFIX = "Hack Night Images";
const CHECK = "✅";
const CROSS = "❌";

/** The photo thread, and not some other thread under the same channel. */
export function isPhotoThread(message: Message): boolean {
  const { channel } = message;
  if (!channel.isThread()) return false;
  if (channel.parentId !== DISCORD_IDS.channels.HACK_NIGHT) return false;
  return channel.name.startsWith(THREAD_NAME_PREFIX);
}

export function hackNightImages(deps: {
  readonly cms: CmsClient;
  readonly slugStore: ThreadSlugStore;
}) {
  return defineEvent({
    name: "hack-night-images",
    kind: "message",
    dedupKey: (message) => message.id,
    handle: async (message) => {
      if (!isPhotoThread(message)) return Result.ok(undefined);

      const images = [...message.attachments.values()].filter(
        (attachment) => attachment.contentType?.startsWith("image/") ?? false,
      );
      if (images.length === 0) return Result.ok(undefined);

      const slug = await resolveEventSlug(deps.slugStore, message.channelId, message.createdAt);

      // The CMS is the source of truth for "already filed", so a replayed
      // message cannot double-file even if dedup has expired.
      const existing = await deps.cms.hasImageForMessage(slug, message.id);
      if (Result.isError(existing)) return Result.map(existing, () => undefined);
      if (existing.value) return Result.ok(undefined);

      let failed = 0;
      for (const image of images) {
        const uploaded = await deps.cms.uploadImage({
          url: image.url,
          slug,
          discordMessageId: message.id,
          discordUserId: message.author.id,
          // Prefixed so two people posting `IMG_1234.jpg` do not collide.
          filename: `${message.id}-${image.name}`,
          contentType: image.contentType ?? "image/jpeg",
        });
        if (Result.isError(uploaded)) failed += 1;
      }

      // One reaction for the message, not one per attachment: a post with four
      // photos should not collect four checkmarks.
      await message.react(failed === 0 ? CHECK : CROSS);
      return Result.ok(undefined);
    },
  });
}

/**
 * ❌ on a filed photo removes it.
 *
 * Allowed for the photo's own author or an organizer. Anyone else reacting ❌ is
 * just reacting — the check is what stops a passer-by deleting someone's photo
 * from the archive.
 */
export function hackNightImageRemoval(deps: {
  readonly cms: CmsClient;
  readonly slugStore: ThreadSlugStore;
}) {
  return defineEvent({
    name: "hack-night-image-removal",
    kind: "reactionAdd",
    dedupKey: ({ reaction, user }) => `${reaction.message.id}:${user.id}`,
    handle: async ({ reaction, user }) => {
      if (reaction.emoji.name !== CROSS) return Result.ok(undefined);

      // Reactions arrive partial, so the message may need fetching. This is the
      // one place that is worth a REST call: without the message there is no
      // author to authorise against.
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;

      if (!isPhotoThread(message)) return Result.ok(undefined);

      const isAuthor = message.author.id === user.id;
      if (!isAuthor) {
        const member = await message.guild?.members.fetch(user.id).catch(() => undefined);
        const role = roleFromMemberRoles(member && [...member.roles.cache.keys()]);
        if (!roleAtLeast(role, UserRole.Organizer)) return Result.ok(undefined);
      }

      const slug = await resolveEventSlug(deps.slugStore, message.channelId, message.createdAt);
      const removed = await deps.cms.deleteImagesForMessage(slug, message.id);
      if (Result.isError(removed)) return Result.map(removed, () => undefined);

      // Clear our own ✅ so the message no longer claims to be archived.
      if (removed.value > 0) {
        await message.reactions.cache.get(CHECK)?.users.remove(message.client.user.id);
      }
      return Result.ok(undefined);
    },
  });
}
