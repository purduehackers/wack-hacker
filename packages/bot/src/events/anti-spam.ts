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
 * One alert per spree, edited as further copies land. A spammer reaching twenty
 * channels must not become twenty pings in the organizer channel.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Client, Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";

/** How long a message keeps counting towards its author's run. */
const SPAM_WINDOW_MS = 120_000;

/** A spree is the same content in more distinct channels than this. */
const SPAM_CHANNEL_LIMIT = 3;

/** Both maps expire by timestamp on read; this only frees the slots. */
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
  readonly url: string;
  readonly attachments: readonly {
    readonly name: string;
    readonly size: number;
    readonly contentType: string | undefined;
  }[];
}

interface Seen {
  readonly signature: bigint;
  readonly channelId: string;
  readonly url: string;
  readonly at: number;
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

function alertBody(copies: readonly string[]): string {
  const links = copies.map((url) => `- ${url}`).join("\n");
  return `# Likely spammer\n${links}\n\n-# False alarm? Please ping Kian to let him know.`;
}

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
    /** The alert body when this message tips its author over the line. */
    observe: (message: SpamMessage): string | undefined => {
      const signature = signatureOf(message);
      const seen = fresh(message.authorId);
      seen.push({
        signature,
        channelId: message.channelId,
        url: message.url,
        at: message.createdAt.getTime(),
      });
      recent.set(message.authorId, seen);

      if (seen.some((prior) => prior.signature !== signature)) return undefined;
      if (new Set(seen.map((prior) => prior.channelId)).size <= SPAM_CHANNEL_LIMIT)
        return undefined;
      return alertBody(seen.map((prior) => prior.url));
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
  return channel.send(body);
}

export function antiSpam() {
  const detector = createSpamDetector();

  /**
   * The open alert per author. The promise rather than the message is stored,
   * and stored before it settles, so two copies landing at once cannot both
   * post — the second one edits what the first is still sending.
   */
  const alerts = new Map<
    string,
    { readonly at: number; readonly message: Promise<Message | undefined> }
  >();

  setInterval(() => {
    detector.sweep();
    const cutoff = Date.now() - SPAM_WINDOW_MS;
    for (const [authorId, open] of alerts) if (open.at < cutoff) alerts.delete(authorId);
  }, SWEEP_INTERVAL_MS).unref();

  return defineEvent({
    name: "anti-spam",
    kind: "message",
    // A RESUME replay must not count one message towards a run twice.
    dedupKey: (message) => message.id,
    handle: async (message) => {
      const body = detector.observe({
        authorId: message.author.id,
        channelId: message.channelId,
        content: message.content,
        createdAt: message.createdAt,
        url: message.url,
        attachments: message.attachments.map((file) => ({
          name: file.name,
          size: file.size,
          contentType: file.contentType ?? undefined,
        })),
      });
      if (body === undefined) return Result.ok(undefined);

      return Result.tryPromise({
        try: async () => {
          const open = alerts.get(message.author.id);
          // A run that aged out earns its own alert; editing the previous one
          // would graft a fresh spree onto a stale list of links.
          const posting =
            open && Date.now() - open.at < SPAM_WINDOW_MS
              ? open.message.then((alert) => alert?.edit(body) ?? postAlert(message.client, body))
              : postAlert(message.client, body);
          alerts.set(message.author.id, {
            at: Date.now(),
            message: posting.catch(() => undefined),
          });
          await posting;
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "post spam alert",
            detail: messageOf(cause),
          }),
      });
    },
  });
}
