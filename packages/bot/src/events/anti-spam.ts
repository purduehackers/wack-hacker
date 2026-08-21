/**
 * Spam detection and prevention.
 */

import { DISCORD_GUILD_ID, DISCORD_IDS } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";

const minutes = (n: number) => n * 60_000;
const SWEEP_INTERVAL_MS = minutes(5);

export type SpamSignature = bigint;

export type SpamAction =
  | { do: "nothing" }
  | { do: "alert"; signature: SpamSignature; alertContent: string };

export interface MessageData {
  authorId: string;
  channelId: string;
  content: string;
  createdAt: Date;
  url: string;
  attachments: { size: number; contentType: string | null; name: string }[];
}

interface MessageInfo {
  signature: SpamSignature;
  message: MessageData;
}

/**
 * SpamDetector handles detecting spam messages and deciding when to alert about
 * them. It avoids integrating with Discord.js so that it can be unit tested.
 */
export class SpamDetector {
  // If an identical message is posted in more than SPAM_CHANNEL_THRESHOLD
  // channels within SPAM_WINDOW_MS, it is spam.
  public readonly SPAM_WINDOW_MS = minutes(2);
  public readonly SPAM_CHANNEL_THRESHOLD = 3;

  private latestMessages: Map<string, MessageInfo[]> = new Map();

  public processMessage(message: MessageData): SpamAction {
    const newMessageSignature = this.signature(message);
    const userLatestMessages = this.getUserLatestMessages(message.authorId);

    const addMessageToList = () => {
      userLatestMessages.push({
        signature: newMessageSignature,
        message,
      });
      if (!this.latestMessages.has(message.authorId)) {
        this.latestMessages.set(message.authorId, userLatestMessages);
      }
    };

    // Only flag if all of the messages have the same signature
    if (!userLatestMessages.every((m) => m.signature === newMessageSignature)) {
      addMessageToList();
      return { do: "nothing" };
    }

    // Flag if the number of unique channels is >threshold
    const channels = new Set(userLatestMessages.map((m) => m.message.channelId));
    channels.add(message.channelId);

    if (channels.size > this.SPAM_CHANNEL_THRESHOLD) {
      addMessageToList();
      const urls = userLatestMessages.map((m) => m.message.url);
      return {
        do: "alert",
        signature: newMessageSignature,
        alertContent: this.makeAlertContent(urls),
      };
    }

    addMessageToList();
    return { do: "nothing" };
  }

  public sweepStaleData() {
    for (const userId of this.latestMessages.keys()) {
      this.getUserLatestMessages(userId);
    }
  }

  private getUserLatestMessages(userId: string): MessageInfo[] {
    const userLatestMessages = this.latestMessages.get(userId);
    if (userLatestMessages === undefined) return [];
    const now = Date.now();
    const stillFresh = userLatestMessages.filter(
      (m) => now - m.message.createdAt.getTime() <= this.SPAM_WINDOW_MS,
    );
    if (stillFresh.length > 0) {
      this.latestMessages.set(userId, stillFresh);
    } else {
      this.latestMessages.delete(userId);
    }
    return stillFresh;
  }

  public signature(message: MessageData): SpamSignature {
    return Bun.hash.wyhash(
      message.content +
        message.attachments.map((a) => (a.contentType ?? "") + a.name + String(a.size)).join(""),
    );
  }

  public makeAlertContent(spamMessageUrls: string[]): string {
    const spamList = spamMessageUrls.map((url) => "- " + url).join("\n");
    return `# Likely spammer\n${spamList}\n\n-# False alarm? Please ping Kian to let him know.`;
  }
}

const detector = new SpamDetector();
// We keep track of the actual Discord Message objects for active alerts so we can call .edit() on them
const activeAlertMessages: Map<SpamSignature, Message<true>> = new Map();

export const antiSpam = defineEvent({
  name: "anti-spam",
  kind: "message",
  dedupKey: (message) => message.id,
  handle: async (message) => {
    if (message.author.bot || !message.inGuild() || message.guildId !== DISCORD_GUILD_ID)
      return Result.ok(undefined);
    const data: MessageData = {
      authorId: message.author.id,
      channelId: message.channelId,
      content: message.content,
      createdAt: message.createdAt,
      url: message.url,
      attachments: message.attachments.map((a) => ({
        size: a.size,
        contentType: a.contentType,
        name: a.name,
      })),
    };
    const action = detector.processMessage(data);
    if (action.do === "nothing") return Result.ok(undefined);
    return await Result.tryPromise({
      try: async () => {
        if (action.do === "alert") {
          const activeAlert = activeAlertMessages.get(action.signature);
          if (activeAlert) {
            await activeAlert.edit(action.alertContent);
          } else {
            const alertChannel = await message.client.channels.fetch(
              DISCORD_IDS.channels.COMMUNITY,
            );
            if (!alertChannel) throw new Error("alert channel not found");
            if (!alertChannel.isTextBased() || alertChannel.isDMBased())
              throw new Error("alert channel is not a guild text channel");

            const sentAlert = await alertChannel.send(action.alertContent);
            activeAlertMessages.set(action.signature, sentAlert);
          }
        }
      },
      catch: (cause) =>
        new Transient({
          operation: "send/edit spam alert message",
          detail: messageOf(cause),
        }),
    });
  },
});

function sweepStaleData() {
  detector.sweepStaleData();

  // Clean up stale alerts
  const now = Date.now();
  for (const [signature, msg] of activeAlertMessages.entries()) {
    const lastUpdated = msg.editedAt ?? msg.createdAt;
    if (lastUpdated.getTime() + detector.SPAM_WINDOW_MS < now) {
      activeAlertMessages.delete(signature);
    }
  }
}

setInterval(sweepStaleData, SWEEP_INTERVAL_MS);
