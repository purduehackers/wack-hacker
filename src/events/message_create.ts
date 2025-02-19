import { Events, MessageFlags, type Message } from "discord.js";
import Groq from "groq-sdk";

import { env } from "../env";
import {
  ORGANIZER_ROLE_ID,
  BISHOP_ROLE_ID,
  EVERGREEN_CREATE_ISSUE_STRING,
} from "../utils/consts";
import { createGithubIssue, getAssociationsFile } from "../utils/github";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export const eventType = Events.MessageCreate;

export async function evergreenIssueWorkflow(message: Message) {
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

  // TODO(theshadoweevee): "/[Ee][Vv][Ee][Rr][Gg][Rr][Ee][Ee][Nn] [Ii][Tt]\s" is ugly. There has to be a better way.
  if (message.content.match(/[Ee][Vv][Ee][Rr][Gg][Rr][Ee][Ee][Nn] [Ii][Tt]\s?([^\s]+)/)) {
    title = (message.content.replace(/[Ee][Vv][Ee][Rr][Gg][Rr][Ee][Ee][Nn] [Ii][Tt]\s?/, "") + ` - @${people[message.author.id] ?? message.author.tag} in #${message.channel.name}`).substring(0, 255) // Limit 0-255 to accomadate Github's 256 Issue Title Length Limit
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

export async function voiceMessageTranscription(message: Message) {
  if (message.author.bot) return;
  if (message.channel.isDMBased()) return;
  if (!message.flags.has(MessageFlags.IsVoiceMessage)) return;

  await message.react("🎙️");

  const audioFile = message.attachments.find(
    (m) => m.name === "voice-message.ogg",
  );
  if (!audioFile) return;

  const file = await fetch(audioFile.url);

  const response = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3",
    language: "en",
  });

  if (!response.text) {
    await message.reply({
      content: "Sorry, I couldn't transcribe that audio message.",
    });
    return;
  }

  await message.reply({
    content: response.text.trim(),
  });
}
