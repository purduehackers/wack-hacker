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
import { isOptedOut } from "@repo/shared/privacy";
import type { RedisClient } from "@repo/shared/redis";
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
function isPhotoThread(message: Message): boolean {
  const { channel } = message;
  if (!channel.isThread()) return false;
  if (channel.parentId !== DISCORD_IDS.channels.HACK_NIGHT) return false;
  return channel.name.startsWith(THREAD_NAME_PREFIX);
}

export function hackNightImages(deps: {
  readonly cms: CmsClient;
  readonly slugStore: ThreadSlugStore;
  readonly redis: RedisClient;
}) {
  return defineEvent({
    name: "hack-night-images",
    kind: "message",
    dedupKey: (message) => message.id,
    handle: async (message, context) => {
      if (context.isBotMention) return Result.ok(undefined);
      if (!isPhotoThread(message)) return Result.ok(undefined);
      // The archive is public, so an opted-out photographer's uploads are
      // skipped entirely rather than filed and hidden.
      if (await isOptedOut(deps.redis, message.author.id)) return Result.ok(undefined);

      const images = [...message.attachments.values()].filter(
        (attachment) => attachment.contentType?.startsWith("image/") ?? false,
      );
      if (images.length === 0) return Result.ok(undefined);

      const slug = await resolveEventSlug(deps.slugStore, message.channelId, message.createdAt);

      let failed = 0;
      for (const attachment of images) {
        // Check each attachment independently. If one upload succeeds and a
        // later one fails, replay must resume the missing file rather than
        // treating the whole Discord message as complete.
        const filename = `${message.id}-${attachment.name}`;
        const existing = await deps.cms.hasImageForMessage(slug, message.id, filename);
        if (Result.isError(existing)) {
          failed += 1;
          continue;
        }
        if (existing.value) continue;

        const uploaded = await deps.cms.uploadImage({
          url: attachment.url,
          slug,
          discordMessageId: message.id,
          discordUserId: message.author.id,
          filename,
          contentType: attachment.contentType ?? "image/jpeg",
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
