import { type Message } from "discord.js";

import {
  BISHOP_ROLE_ID,
  ORGANIZER_ROLE_ID,
  EVERGREEN_CREATE_ISSUE_STRING,
} from "../../utils/consts";
import { createGithubIssue, getAssociationsFile } from "../../utils/github";

export default async function handler(message: Message) {
  if (message.author.bot) return;
  if (message.channel.isDMBased()) return;

  if (
    !message.member?.roles.cache.some(
      (r) => r.id === ORGANIZER_ROLE_ID || r.id === BISHOP_ROLE_ID,
    )
  ) {
    return;
  }

  if (!message.content.toLowerCase().startsWith(EVERGREEN_CREATE_ISSUE_STRING))
    return;

  let original: Message;

  if (!message.reference || !message.reference.messageId) {
    const messages = await message.channel.messages.fetch({ limit: 2 });
    const [_, ref] = Array.from(messages.values());
    original = ref;
  } else {
    original = await message.channel.messages.fetch(
      message.reference!.messageId,
    );
  }

  if (!original) return;

  const people = await getAssociationsFile();
  const assignees: string[] = [
    people[message.author.id],
    people[original.author.id],
  ].filter(Boolean);

  // TODO(rayhanadev): generate title using groq
  let title = `Evergreen request from @${people[message.author.id] ?? message.author.tag} in #${message.channel.name}`;

  if (message.content.match(/^evergreen it\s?/i)) {
    title = (
      message.content.replace(/^evergreen it\s?/i, "") +
      ` - @${people[message.author.id] ?? message.author.tag} in #${message.channel.name}`
    ).substring(0, 255); // Limit 0-255 to accomadate Github's 256 Issue Title Length Limit
  }

  const body = `**@${people[original.author.id] ?? original.author.tag}**[^1] said in **[#${message.channel.name}](<${message.url}>)**:

${original.content
  .split("\n")
  .map((line) => `> ${line}`)
  .join("\n")}

[^1]: @${people[message.author.id] ?? message.author.tag} please edit this issue to include any additional context or details you think are
      necessary, and/or assign it to someone else if you would not want to do it.`;

  const { html_url } = await createGithubIssue(title, body, assignees);

  await message.reply(`Created issue: ${html_url}`);
}
