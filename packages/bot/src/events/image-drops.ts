/**
 * Filing image-drop threads to the CMS.
 *
 * Images posted in a drop thread are uploaded to the CMS under that drop's batch
 * id, and — when the drop is linked to a CMS event — attached to the event's
 * gallery as well. Two handlers: the upload, and an ❌ reaction that takes a
 * photo back out again.
 *
 * A thread is a drop when it has a stored drop record. The weekly hack night
 * photo thread is the one exception: it is recognised by its parent channel and
 * name too, so a lost Redis record downgrades the archive to a date-derived
 * batch rather than dropping the night's photos on the floor.
 *
 * The ✅ / ❌ reactions are the whole feedback mechanism — uploading happens in
 * the background and a photo that silently failed to file would only be noticed
 * when it was missing from the leaderboard.
 */

import { DISCORD_IDS, UserRole, roleAtLeast, roleFromMemberRoles } from "@repo/shared/discord";
import { messageOf, tagOf, UpstreamError } from "@repo/shared/errors";
import { isOptedOut } from "@repo/shared/privacy";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import type { Attachment, Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import type { CmsClient } from "../integrations/cms.ts";
import {
  altTextFor,
  HACK_NIGHT_THREAD_PREFIX,
  hackNightDrop,
  resolveDrop,
} from "../integrations/image-drop.ts";
import type { ImageDrop, ImageDropStore } from "../integrations/image-drop.ts";

const CHECK = "✅";
const CROSS = "❌";

/** How long the "could not attach" notice suppresses its repeats. */
const ATTACH_NOTICE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The weekly photo thread, and not some other thread under the same channel. */
function isPhotoThread(message: Message): boolean {
  const { channel } = message;
  if (!channel.isThread()) return false;
  if (channel.parentId !== DISCORD_IDS.channels.HACK_NIGHT) return false;
  return channel.name.startsWith(HACK_NIGHT_THREAD_PREFIX);
}

/**
 * The drop this message belongs to, or `undefined` when the thread is not one.
 *
 * The hack night fallback is deliberately the *only* derived drop: filing images
 * from an arbitrary thread under a guessed batch would put photos in the archive
 * that nobody asked for.
 */
async function dropForMessage(
  drops: ImageDropStore,
  message: Message,
): Promise<ImageDrop | undefined> {
  if (!message.channel.isThread()) return undefined;
  if (isPhotoThread(message)) {
    return resolveDrop(drops, message.channelId, hackNightDrop(message.createdAt));
  }

  const stored = await drops.get(message.channelId);
  if (Result.isError(stored)) return undefined;
  return stored.value;
}

interface UploadDeps {
  readonly cms: CmsClient;
  readonly drops: ImageDropStore;
  readonly redis: RedisClient;
  readonly reporter: Reporter;
}

/**
 * A per-attachment failure, under its own op so the three CMS calls are
 * separable in metrics: a failing existence check means the archive cannot be
 * read, a failing upload means a photo was lost, and a failing attach means a
 * photo was archived but never reached the event. The handler itself still
 * returns ok, so without this the wide event for the whole message reports
 * success and only the ❌ says otherwise.
 */
function reportFailure(
  reporter: Reporter,
  op: "image-drop.check" | "image-drop.upload" | "image-drop.attach",
  error: unknown,
  attributes: { readonly batchId: string; readonly filename: string; readonly messageId: string },
): void {
  reporter.emit({
    op,
    status: "error",
    errorTag: tagOf(error),
    errorMessage: messageOf(error),
    attributes,
  });
}

/**
 * What became of one attachment.
 *
 * `refused` is archived but not on the event, and carries what the CMS said so
 * the thread notice can quote it rather than guess at a cause.
 */
interface Filing {
  readonly outcome: "filed" | "refused" | "failed";
  readonly reason?: string;
}

/** Short enough for Discord; the full detail goes to telemetry. */
function refusalReason(error: unknown): string {
  return UpstreamError.is(error) ? `the CMS answered ${error.status}` : messageOf(error);
}

async function fileImage(
  deps: UploadDeps,
  drop: ImageDrop,
  message: Message,
  attachment: Attachment,
): Promise<Filing> {
  // Check each attachment independently. If one upload succeeds and a later one
  // fails, replay must resume the missing file rather than treating the whole
  // Discord message as complete.
  const filename = `${message.id}-${attachment.name}`;
  const reported = { batchId: drop.batchId, filename, messageId: message.id };

  const existing = await deps.cms.hasImageForMessage(drop, message.id, filename);
  if (Result.isError(existing)) {
    reportFailure(deps.reporter, "image-drop.check", existing.error, reported);
    return { outcome: "failed" };
  }
  if (existing.value) return { outcome: "filed" };

  const uploaded = await deps.cms.uploadImage({
    batch: drop,
    url: attachment.url,
    alt: altTextFor(drop, filename),
    discordMessageId: message.id,
    discordUserId: message.author.id,
    filename,
    contentType: attachment.contentType ?? "image/jpeg",
  });
  if (Result.isError(uploaded)) {
    reportFailure(deps.reporter, "image-drop.upload", uploaded.error, reported);
    return { outcome: "failed" };
  }

  if (drop.event === undefined) return { outcome: "filed" };

  const attached = await deps.cms.attachImages(drop.event.id, [uploaded.value.id]);
  if (!Result.isError(attached)) return { outcome: "filed" };

  // Always reported, whatever the status. The photo is archived either way, so
  // this never shows on the reaction — and an attach that fails silently is what
  // once left an organizer chasing a wrong explanation through the CMS.
  reportFailure(deps.reporter, "image-drop.attach", attached.error, reported);
  return { outcome: "refused", reason: refusalReason(attached.error) };
}

/**
 * Says once, in the thread, that images are landing in the archive but not on
 * the event.
 *
 * Whatever stops the attach usually stops every attach for the rest of the
 * night, so the notice is claimed through Redis and said once. The reaction
 * stays ✅ because the photos really are filed — only the event link is missing,
 * and the batch is what an editor needs to finish the job by hand.
 *
 * It quotes what the CMS said rather than naming a cause. The status alone does
 * not identify one: `attachImages` already treats a saved-then-failed write as
 * success, so anything reaching here is genuinely not on the event, but *why* is
 * a question for the telemetry this also emits.
 */
async function noticeAttachRefused(
  deps: UploadDeps,
  message: Message,
  drop: ImageDrop,
  reason: string,
): Promise<void> {
  const claimed = await Result.tryPromise({
    try: () =>
      deps.redis.set(`image-drop:attach-notice:${message.channelId}`, "1", {
        nx: true,
        ex: ATTACH_NOTICE_TTL_SECONDS,
      }),
    catch: (cause) => cause,
  });
  if (Result.isError(claimed) || claimed.value !== "OK") return;
  if (!message.channel.isSendable()) return;

  await message.channel.send(
    `Heads up: these photos are archived under batch \`${drop.batchId}\`, but I could not add ` +
      `them to the event itself (${reason}). An editor can filter the media library by that ` +
      "batch and attach them in one go.",
  );
}

export function imageDropUploads(deps: UploadDeps) {
  return defineEvent({
    name: "image-drop-upload",
    kind: "message",
    dedupKey: (message) => message.id,
    handle: async (message, context) => {
      if (context.isBotMention) return Result.ok(undefined);

      const images = [...message.attachments.values()].filter(
        (attachment) => attachment.contentType?.startsWith("image/") ?? false,
      );
      if (images.length === 0) return Result.ok(undefined);

      const drop = await dropForMessage(deps.drops, message);
      if (drop === undefined) return Result.ok(undefined);

      // The archive is public, so an opted-out photographer's uploads are
      // skipped entirely rather than filed and hidden.
      if (await isOptedOut(deps.redis, message.author.id)) return Result.ok(undefined);

      let failed = 0;
      let refusal: string | undefined;
      for (const attachment of images) {
        const filing = await fileImage(deps, drop, message, attachment);
        if (filing.outcome === "failed") failed += 1;
        if (filing.outcome === "refused") refusal ??= filing.reason;
      }
      if (refusal !== undefined) await noticeAttachRefused(deps, message, drop, refusal);

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
export function imageDropRemoval(deps: {
  readonly cms: CmsClient;
  readonly drops: ImageDropStore;
}) {
  return defineEvent({
    name: "image-drop-removal",
    kind: "reactionAdd",
    dedupKey: ({ reaction, user }) => `${reaction.message.id}:${user.id}`,
    handle: async ({ reaction, user }) => {
      if (reaction.emoji.name !== CROSS) return Result.ok(undefined);

      // Reactions arrive partial, so the message may need fetching. This is the
      // one place that is worth a REST call: without the message there is no
      // author to authorise against.
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;

      const drop = await dropForMessage(deps.drops, message);
      if (drop === undefined) return Result.ok(undefined);

      const isAuthor = message.author.id === user.id;
      if (!isAuthor) {
        const member = await message.guild?.members.fetch(user.id).catch(() => undefined);
        const role = roleFromMemberRoles(member && [...member.roles.cache.keys()]);
        if (!roleAtLeast(role, UserRole.Organizer)) return Result.ok(undefined);
      }

      const removed = await deps.cms.deleteImagesForMessage(drop, message.id);
      if (Result.isError(removed)) return Result.map(removed, () => undefined);
      if (removed.value.length === 0) return Result.ok(undefined);

      // Clear our own ✅ first: the media is already gone, so the reaction is
      // wrong from this moment whatever the event write does next.
      await message.reactions.cache.get(CHECK)?.users.remove(message.client.user.id);

      // Detach after the delete, because the delete is what names the media that
      // were actually removed. A failure here leaves a row pointing at a deleted
      // upload, which an editor can clear — the alternative is refusing to remove
      // a photo someone asked to remove. It is still reported: `detachImages`
      // verifies before believing a failing status, so what reaches here is real.
      if (drop.event !== undefined) {
        const detached = await deps.cms.detachImages(
          drop.event.id,
          removed.value.map((image) => image.id),
        );
        if (Result.isError(detached)) return Result.map(detached, () => undefined);
      }

      return Result.ok(undefined);
    },
  });
}
