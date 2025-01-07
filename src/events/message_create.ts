import type { Message } from "discord.js";

import {
  ORGANIZER_ROLE_ID,
  EVERGREEN_CREATE_ISSUE_STRING,
} from "../utils/consts";
import { createGithubIssue, getAssociationsFile } from "../utils/github";

export async function evergreenIssueWorkflow(message: Message) {
  if (message.author.bot) return;
  if (message.channel.isDMBased()) return;

  if (!message.member?.roles.cache.some((r) => r.id === ORGANIZER_ROLE_ID)) {
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
  const assignees: string | null = people[original.author.id] || null;

  const title = `Evergreen request from @${message.author.tag} in #${message.channel.name}`;
  const body = `**@${assignees ?? original.author.tag}** said in **[#${message.channel.name}](${message.url})**:

  ${original.content
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;

  const { html_url } = await createGithubIssue(
    title,
    body,
    assignees ? [assignees] : [],
  );

  await message.reply(`Created issue: ${html_url}`);
}
