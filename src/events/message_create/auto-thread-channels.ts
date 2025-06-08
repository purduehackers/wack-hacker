// loosely based on https://github.com/hackclub/scrappy
//
import { type Message } from "discord.js";

const SHIP_CHANNEL_ID = "904896819165814794";
const CHECKPOINTS_CHANNEL_ID = "1052236377338683514";

const AUTO_THREAD_CHANNELS = [SHIP_CHANNEL_ID, CHECKPOINTS_CHANNEL_ID];
// TODO(@rayhanadev): this is honestly shitty but breaks less
// than requiring people to add an image like Scrappy does. Look
// into phasing this out or doing something different.
const VALID_PROJECT_LINKS = ["https://github.com/"];

const CHECKPOINT_RESPONSE_MESSAGES = [
  "Great checkpoint! :D",
  "Nice progress! :D",
  "Awesome update! :D",
  "Yay thanks for sharing! :D",
  "Yippie!! Keep it up! :D",
];

const SHIP_RESPONSE_MESSAGES = [
  "Congrats on shipping! :D",
  "You shipped it! :D",
  "That’s a wrap! :D",
  "Yay thanks for sharing! :D",
  "Yippie!! Great work! :D",
  "Launched and loved! :D",
  "Woohoo, it's live now! :D",
  "Done and dusted! :D",
  "High-five on the ship! :D",
  "Boom, nice ship! :D",
];

export default async function handler(message: Message) {
  if (message.author.bot) return;
  if (message.channel.isDMBased()) return;

  if (!AUTO_THREAD_CHANNELS.includes(message.channelId)) return;

  const hasProjectLink = containsValidProjectLink(message.content);
  const hasAttachment = message.attachments.size > 0;

  if (!hasProjectLink && !hasAttachment) {
    await message.delete();
    return;
  }

  // NOTE: add a condition when updating AUTO_THREAD_CHANNELS
  const type =
    message.channelId === CHECKPOINTS_CHANNEL_ID
      ? "checkpoint"
      : message.channelId === SHIP_CHANNEL_ID
        ? "ship"
        : "something???";

  // TODO(@rayhanadev): use groq to generate title?
  const thread = await message.startThread({
    name: `${message.author.displayName}'s ${type}!`,
  });

  if (message.channelId === CHECKPOINTS_CHANNEL_ID) {
    await thread.send(
      CHECKPOINT_RESPONSE_MESSAGES[
        Math.floor(Math.random() * CHECKPOINT_RESPONSE_MESSAGES.length)
      ],
    );
    // TODO(@rayhanadev): integrate potential scrapbook
    // TODO(@rayhanadev): add auto-emoji behavior
  }

  if (message.channelId === SHIP_CHANNEL_ID) {
    await message.react("🎉");
    await message.react("✨");
    await message.react("🚀");
    await thread.send(
      SHIP_RESPONSE_MESSAGES[
        Math.floor(Math.random() * SHIP_RESPONSE_MESSAGES.length)
      ],
    );

    // TODO(@rayhanadev): integrate potential scrapbook
    // TODO(@rayhanadev): add auto-emoji behavior
    // TODO(@rayhanadev): add hook for SIGHORSE
  }
}

function containsValidProjectLink(text: string): boolean {
  return VALID_PROJECT_LINKS.some((host) => text.includes(host));
}
