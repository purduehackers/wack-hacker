/**
 * Pings `@organizers` when someone in `#hack-night` asks to be let into BHEE.
 *
 * BHEE (the Brown Family Hall of Electrical Engineering) locks its exterior
 * doors in the evening, so late arrivals to Hack Night regularly post in the
 * channel asking someone to come open a door.
 *
 * Detection runs in two stages so normal Hack Night chatter costs nothing:
 *
 * 1. **Cheap local gates.** Must be in `#hack-night` (or a thread under it),
 *    while Hack Night is actually active, from a non-organizer who did not
 *    already ping organizers, and the text must contain a door/building/entry
 *    cue.
 * 2. **LLM intent check.** Candidates that pass the regex pre-filter are sent
 *    to a fast Groq model (`llama-3.1-8b-instant`) to distinguish a real
 *    "please let me in" request from incidental mentions like "I'm heading to
 *    BHEE soon" or "see you at the door".
 */

import { createGroq } from "@ai-sdk/groq";
import { DISCORD_IDS, UserRole, roleAtLeast, roleFromMemberRoles } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { generateText, Output } from "ai";
import { ChannelType } from "discord.js";
import type { MessageReplyOptions } from "discord.js";
import { z } from "zod";

import { defineEvent } from "../framework/events.ts";
import { wallClockDate } from "../utils/dates.ts";

/** 🌙 — the `#hack-night` channel's prefix when Hack Night is not running. */
const DEFAULT_EMOJI = "\u{1F319}";

/**
 * Broad pre-filter for messages that might be asking for building entry.
 *
 * Kept intentionally generous because the LLM classifier makes the final call;
 * this only exists to keep ordinary conversation off the network.
 */
const ENTRY_CUE_PATTERN =
  /\b(?:bhee|ee\b|brown\s+family|door|doors|locked|lock|let\s+(?:me|us)\s+in|open\s+up|outside|front\s+entrance|side\s+entrance|stuck\s+outside|get\s+in(?:to)?|come\s+open|let\s+in)\b/iu;

const classificationSchema = z.strictObject({
  needsLetIn: z.boolean(),
});

const SYSTEM_PROMPT = [
  "You classify Discord messages sent in Purdue Hackers' #hack-night channel during Hack Night.",
  "Hack Night takes place in BHEE (Brown Family Hall of Electrical Engineering, also called EE).",
  "The building doors lock at night, so attendees often arrive outside and ask in chat for someone to let them in or open a door.",
  "",
  "Return `needsLetIn: true` ONLY when the author is currently asking someone to let them (or their group) into the building / open a locked door right now.",
  "Examples that ARE true:",
  '- "can someone let me into bhee"',
  '- "im outside the front doors, locked out"',
  '- "at the side door can someone open"',
  '- "locked out of ee, anyone near the entrance?"',
  '- "we are outside bhee can someone let us in"',
  "",
  "Return `needsLetIn: false` for everything else, including:",
  "- Saying they are on their way or will arrive later (e.g. 'heading to bhee in 10 mins')",
  "- Asking where the room is once already inside, or asking general questions about BHEE or Hack Night",
  "- Saying they just let someone in or are going to get the door (e.g. 'omw to the door', 'got u')",
  "- Past-tense stories, jokes, or general discussion mentioning BHEE or doors",
].join("\n");

export interface BheeClassifierDeps {
  readonly apiKey: string;
}

export interface BheeClassifier {
  readonly isLetInRequest: (content: string) => Promise<Result<boolean, Transient>>;
}

export function createBheeClassifier(deps: BheeClassifierDeps): BheeClassifier {
  const groq = createGroq({ apiKey: deps.apiKey });

  return {
    isLetInRequest: async (content) =>
      Result.tryPromise({
        try: async () => {
          const { output } = await generateText({
            model: groq("llama-3.1-8b-instant"),
            system: SYSTEM_PROMPT,
            prompt: content,
            temperature: 0,
            maxOutputTokens: 64,
            output: Output.object({ schema: classificationSchema }),
          });
          return output.needsLetIn;
        },
        catch: (cause) =>
          new Transient({
            operation: "classify BHEE entry request",
            detail: messageOf(cause),
          }),
      }),
  };
}

/** True when `content` mentions a building, door, or entry cue worth classifying. */
export function hasBheeEntryCue(content: string): boolean {
  return ENTRY_CUE_PATTERN.test(content);
}

/**
 * Fallback window in `America/Indiana/Indianapolis`: Friday 19:00 through
 * Saturday 06:00. Covers Hack Night even when `/hack-night start` was skipped.
 */
export function isWithinHackNightWindow(at: Date): boolean {
  const local = wallClockDate(at);
  const day = local.getDay();
  const hour = local.getHours();
  return (day === 5 && hour >= 19) || (day === 6 && hour < 6);
}

/**
 * Whether Hack Night is currently active.
 *
 * Two signals count:
 * - An organizer ran `/hack-night start`, which swaps the channel's leading 🌙
 *   for the week's emoji until `/hack-night reset` puts it back.
 * - It is Friday night / early Saturday morning in Indiana.
 */
export function isHackNightActive(channelName: string | undefined, at: Date): boolean {
  if (channelName !== undefined && !channelName.startsWith(DEFAULT_EMOJI)) {
    return true;
  }
  return isWithinHackNightWindow(at);
}

interface BheePingChannel {
  readonly id: string;
  readonly name?: string | null;
  readonly type?: ChannelType;
  readonly parentId?: string | null;
  readonly parent?: { readonly name: string } | null;
  readonly isThread: () => boolean;
}

type MemberRoleSource =
  | string[]
  | { readonly cache: { readonly keys: () => IterableIterator<string> } };

export interface BheePingMessage {
  readonly id: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly channel: BheePingChannel;
  readonly member?: { readonly roles: MemberRoleSource } | null;
  readonly mentions: {
    readonly roles: {
      readonly has: (roleId: string) => boolean;
    };
  };
  readonly reply: (options: MessageReplyOptions) => Promise<unknown>;
}

function senderRole(message: Pick<BheePingMessage, "member">): UserRole {
  const roles = message.member?.roles;
  if (roles === undefined) return UserRole.Public;
  return roleFromMemberRoles("cache" in roles ? [...roles.cache.keys()] : roles);
}

function hackNightChannelName(channel: BheePingChannel): string | undefined {
  if (channel.id === DISCORD_IDS.channels.HACK_NIGHT) {
    return channel.name ?? undefined;
  }
  if (channel.isThread() && channel.parentId === DISCORD_IDS.channels.HACK_NIGHT) {
    return channel.parent?.name ?? undefined;
  }
  return undefined;
}

function isInHackNightChannel(channel: BheePingChannel): boolean {
  if (channel.id === DISCORD_IDS.channels.HACK_NIGHT) return true;
  if (!channel.isThread()) return false;
  if (channel.type === ChannelType.PrivateThread) return false;
  return channel.parentId === DISCORD_IDS.channels.HACK_NIGHT;
}

export function organizerPingReply(): string {
  return `<@&${DISCORD_IDS.roles.ORGANIZER}> someone needs to be let into BHEE!`;
}

export async function pingOrganizersIfNeeded(
  message: BheePingMessage,
  classifier: BheeClassifier,
): Promise<Result<undefined, Transient>> {
  if (!isInHackNightChannel(message.channel)) return Result.ok(undefined);

  // Organizers and admins already have building access or are the ones
  // answering the door; their messages should never trigger a self-ping.
  if (roleAtLeast(senderRole(message), UserRole.Organizer)) return Result.ok(undefined);

  // If the author already pinged `@organizers`, a second ping from the bot
  // is just noise.
  if (message.mentions.roles.has(DISCORD_IDS.roles.ORGANIZER)) return Result.ok(undefined);

  const content = message.content.trim();
  if (content === "" || !hasBheeEntryCue(content)) return Result.ok(undefined);

  const channelName = hackNightChannelName(message.channel);
  if (!isHackNightActive(channelName, message.createdAt)) return Result.ok(undefined);

  const classification = await classifier.isLetInRequest(content);
  if (Result.isError(classification)) return classification;
  if (!classification.value) return Result.ok(undefined);

  return Result.tryPromise({
    try: async () => {
      await message.reply({
        content: organizerPingReply(),
        allowedMentions: {
          roles: [DISCORD_IDS.roles.ORGANIZER],
          repliedUser: true,
        },
      });
      return undefined;
    },
    catch: (cause) =>
      new Transient({
        operation: "ping organizers for BHEE entry",
        detail: messageOf(cause),
      }),
  });
}

export function bheePing(classifier: BheeClassifier) {
  return defineEvent({
    name: "bhee-ping",
    kind: "message",
    dedupKey: (message) => message.id,
    handle: async (message, context) => {
      if (context.isBotMention) return Result.ok(undefined);
      return pingOrganizersIfNeeded(message, classifier);
    },
  });
}
