/**
 * Cross-channel spam detection.
 *
 * The signal is one person posting the *same* thing in several channels within
 * a couple of minutes — the shape a compromised account takes when it fires a
 * scam link at every channel it can see. Repetition inside a single channel is
 * exempt on purpose: that is someone being annoying, not an attack.
 *
 * Anything else the author says inside the window ends the run, so a member
 * cross-posting a link while also talking is never flagged. That bias is
 * deliberate — the alert names a member to the organizers and asks them to act,
 * so the detector would rather miss a spree than invent one.
 *
 * Once detected, every copy in the run is removed and the author is notified
 * once. One organizer alert per spree is edited as further copies land, so a
 * spammer reaching twenty channels does not produce twenty alerts.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Client, Guild, Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";

/** How long a message keeps counting towards its author's run. */
const SPAM_WINDOW_MS = 120_000;

/** A spree is the same content in more distinct channels than this. */
const SPAM_CHANNEL_LIMIT = 3;

/** Detection state expires on read; this interval frees inactive spree state. */
const SWEEP_INTERVAL_MS = 300_000;

/**
 * What the detector reasons about, and nothing from discord.js — the decision
 * is the part worth testing, and it should not need a gateway to exercise.
 */
export interface SpamMessage {
  readonly authorId: string;
  readonly channelId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly messageId: string;
  readonly attachments: readonly {
    readonly name: string;
    readonly size: number;
    readonly contentType: string | undefined;
  }[];
}

interface Seen {
  readonly signature: bigint;
  readonly channelId: string;
  readonly messageId: string;
  readonly at: number;
}

export interface SpamCopy {
  readonly channelId: string;
  readonly messageId: string;
}

export interface SpamDetection {
  readonly body: string;
  readonly copies: readonly SpamCopy[];
}

/**
 * Hashed rather than kept whole, so a window of long messages cannot pin its
 * own text in memory. Attachments count towards identity because the spam that
 * matters here is often an image with a one-word caption.
 */
function signatureOf(message: SpamMessage): bigint {
  const parts = message.attachments.map(
    (file) => `${file.contentType ?? ""}${file.name}${file.size}`,
  );
  return Bun.hash.wyhash(message.content + parts.join(""));
}

function alertBody(authorId: string, channelIds: readonly string[]): string {
  const channels = [...new Set(channelIds)].map((id) => `- <#${id}>`).join("\n");
  return `# Likely spammer\n<@${authorId}> sent repeated messages in:\n${channels}\n\n-# False alarm? Please ping Kian to let him know.`;
}

const SPAMMER_NOTICE = `Hello!

I'm Wack Hacker, a bot for Purdue Hackers.

I deleted some of your recent messages because they look like spam.
If this is a mistake, please let an organizer know.`;

/**
 * Per-author message history, and the verdict on each new message.
 *
 * A factory rather than a module singleton so a test gets its own state, for
 * the same reason the registries build their dependencies explicitly.
 */
export function createSpamDetector() {
  const recent = new Map<string, Seen[]>();

  const fresh = (authorId: string): Seen[] => {
    const cutoff = Date.now() - SPAM_WINDOW_MS;
    return (recent.get(authorId) ?? []).filter((seen) => seen.at >= cutoff);
  };

  return {
    /** The affected messages and alert body once this run crosses the limit. */
    observe: (message: SpamMessage): SpamDetection | undefined => {
      const signature = signatureOf(message);
      const seen = fresh(message.authorId);
      seen.push({
        signature,
        channelId: message.channelId,
        messageId: message.messageId,
        at: message.createdAt.getTime(),
      });
      recent.set(message.authorId, seen);

      if (seen.some((prior) => prior.signature !== signature)) return undefined;
      if (new Set(seen.map((prior) => prior.channelId)).size <= SPAM_CHANNEL_LIMIT)
        return undefined;
      return {
        body: alertBody(
          message.authorId,
          seen.map((prior) => prior.channelId),
        ),
        copies: seen.map((prior) => ({
          channelId: prior.channelId,
          messageId: prior.messageId,
        })),
      };
    },

    /** Forgets authors whose runs have fully aged out. */
    sweep: (): void => {
      for (const authorId of recent.keys()) {
        if (fresh(authorId).length === 0) recent.delete(authorId);
      }
    },
  };
}

async function postAlert(client: Client, body: string): Promise<Message> {
  const channel = await client.channels.fetch(DISCORD_IDS.channels.COMMUNITY);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new Error("spam alert channel is not a guild text channel");
  }
  return channel.send({ content: body, allowedMentions: { parse: [] } });
}

async function deleteMessages(
  guild: Guild,
  targets: readonly SpamCopy[],
  deleted: Set<string>,
): Promise<void> {
  const pending = targets.filter((entry) => !deleted.has(entry.messageId));
  const settled = await Promise.allSettled(
    pending.map(async (entry) => {
      const channel = await guild.channels.fetch(entry.channelId);
      if (channel === null || !channel.isTextBased()) {
        throw new Error(`spam message channel is not text-based: ${entry.channelId}`);
      }
      await channel.messages.delete(entry.messageId);
      deleted.add(entry.messageId);
    }),
  );
  const failures = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "could not delete every spam message");
}

export function antiSpam() {
  const detector = createSpamDetector();

  /**
   * The open moderation state per author. Promises are stored before they
   * settle, so simultaneous copies serialize their alert edits and deletions.
   */
  const sprees = new Map<
    string,
    {
      readonly at: number;
      readonly alert: Promise<Message | undefined>;
      readonly deletion: Promise<void>;
      readonly deleted: Set<string>;
    }
  >();

  setInterval(() => {
    detector.sweep();
    const cutoff = Date.now() - SPAM_WINDOW_MS;
    for (const [authorId, open] of sprees) if (open.at < cutoff) sprees.delete(authorId);
  }, SWEEP_INTERVAL_MS).unref();

  return defineEvent({
    name: "anti-spam",
    kind: "message",
    // A RESUME replay must not count one message towards a run twice.
    dedupKey: (message) => message.id,
    handle: async (message) => {
      const guild = message.guild;
      if (guild === null) return Result.ok(undefined);

      const detection = detector.observe({
        authorId: message.author.id,
        channelId: message.channelId,
        content: message.content,
        createdAt: message.createdAt,
        messageId: message.id,
        attachments: message.attachments.map((file) => ({
          name: file.name,
          size: file.size,
          contentType: file.contentType ?? undefined,
        })),
      });
      if (detection === undefined) return Result.ok(undefined);

      return Result.tryPromise({
        try: async () => {
          const open = sprees.get(message.author.id);
          const active = open && Date.now() - open.at < SPAM_WINDOW_MS ? open : undefined;
          // A run that aged out earns its own alert; editing the previous one
          // would graft a fresh spree onto a stale list of channels.
          const posting =
            active === undefined
              ? postAlert(message.client, detection.body)
              : active.alert.then(
                  (alert) =>
                    alert?.edit({ content: detection.body, allowedMentions: { parse: [] } }) ??
                    postAlert(message.client, detection.body),
                );
          const deleted = active?.deleted ?? new Set<string>();
          const deletion = (active?.deletion ?? Promise.resolve())
            .catch(() => undefined)
            .then(() => deleteMessages(guild, detection.copies, deleted));
          const notifying =
            active === undefined
              ? message.author.send(SPAMMER_NOTICE).catch((cause: unknown) => {
                  console.warn(`could not notify spammer ${message.author.id}`, cause);
                })
              : Promise.resolve();

          sprees.set(message.author.id, {
            at: Date.now(),
            alert: posting.catch(() => undefined),
            deletion: deletion.catch(() => undefined),
            deleted,
          });
          await Promise.all([posting, deletion, notifying]);
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "remove spam and alert organizers",
            detail: messageOf(cause),
          }),
      });
    },
  });
}
