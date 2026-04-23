import type { API } from "@discordjs/core/http-only";

import { groq } from "@ai-sdk/groq";
import { experimental_transcribe as transcribe } from "ai";
import { MessageFlags } from "discord.js";
import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { MessageRenderer } from "@/lib/ai/message-renderer";
import { splitOggOpus } from "@/lib/audio/ogg-opus-splitter";

const TRANSCRIPTION_FAILED = "Sorry, I couldn't transcribe that audio message.";

const CHUNK_THRESHOLD = 24 * 1024 * 1024;
const CHUNK_TARGET = 20 * 1024 * 1024;
const CHUNK_RETRY_DELAY_MS = 750;

const MAX_DISCORD_CONTENT = 1900;

const TOO_LARGE_PATTERN = /\b413\b|too large|payload|exceeds|size limit|too big/i;

async function transcribeOnce(audio: Uint8Array): Promise<string> {
  const result = await transcribe({
    model: groq.transcription("whisper-large-v3"),
    audio,
    providerOptions: { groq: { language: "en" } },
  });
  return result.text;
}

async function transcribeChunked(buffer: Uint8Array): Promise<{ text: string; partCount: number }> {
  const { chunks } = splitOggOpus(buffer, { targetBytes: CHUNK_TARGET });

  const settled = await Promise.allSettled(
    chunks.map(async (chunk, i) => {
      const label = i + 1 + "/" + chunks.length;
      try {
        return await transcribeOnce(chunk);
      } catch (err) {
        log.warn("voice-transcription", "Chunk " + label + " first attempt failed: " + String(err));
        await new Promise((resolve) => setTimeout(resolve, CHUNK_RETRY_DELAY_MS));
        try {
          return await transcribeOnce(chunk);
        } catch (retryErr) {
          log.warn("voice-transcription", "Chunk " + label + " retry failed: " + String(retryErr));
          throw retryErr;
        }
      }
    }),
  );

  const parts = settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : "[part " + (i + 1) + "/" + chunks.length + " failed]",
  );
  const successes = settled.filter((s) => s.status === "fulfilled").length;

  if (successes === 0) {
    throw new Error("all chunks failed to transcribe");
  }

  return { text: parts.join(" ").trim(), partCount: chunks.length };
}

async function postTranscript(
  discord: API,
  channelId: string,
  messageId: string,
  text: string,
  partCount: number,
): Promise<void> {
  const footer = partCount > 1 ? "\n-# Transcribed in " + partCount + " parts" : "";
  const body = text || TRANSCRIPTION_FAILED;

  if (body.length + footer.length <= MAX_DISCORD_CONTENT) {
    await discord.channels.createMessage(channelId, {
      content: body + footer,
      message_reference: { message_id: messageId },
    });
    return;
  }

  const messages = MessageRenderer.splitText(body, MAX_DISCORD_CONTENT);
  const lastIdx = messages.length - 1;
  if (footer) {
    if (messages[lastIdx]!.length + footer.length <= MAX_DISCORD_CONTENT) {
      messages[lastIdx] = messages[lastIdx]! + footer;
    } else {
      const reSplit = MessageRenderer.splitText(
        messages[lastIdx]!,
        MAX_DISCORD_CONTENT - footer.length,
      );
      messages.splice(lastIdx, 1, ...reSplit);
      messages[messages.length - 1] = messages[messages.length - 1]! + footer;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    await discord.channels.createMessage(channelId, {
      content: messages[i]!,
      ...(i === 0 ? { message_reference: { message_id: messageId } } : {}),
    });
  }
}

export const voiceTranscription = defineEvent({
  type: "message",
  async handle(packet, ctx) {
    const { flags, attachments, channel, id: messageId } = packet.data;
    if (!flags || !(flags & MessageFlags.IsVoiceMessage)) return;

    const audio = attachments.find((a) => a.filename.endsWith(".ogg"));
    if (!audio) return;

    await ctx.discord.channels.addMessageReaction(channel.id, messageId, "\u{1F399}\u{FE0F}");

    try {
      const response = await fetch(audio.url);
      const buffer = new Uint8Array(await response.arrayBuffer());

      let text: string;
      let partCount: number;

      if (buffer.byteLength > CHUNK_THRESHOLD) {
        ({ text, partCount } = await transcribeChunked(buffer));
      } else {
        try {
          text = await transcribeOnce(buffer);
          partCount = 1;
        } catch (err) {
          if (!TOO_LARGE_PATTERN.test(String(err))) throw err;
          log.warn(
            "voice-transcription",
            "Fast path hit size error, falling back to chunked: " + String(err),
          );
          ({ text, partCount } = await transcribeChunked(buffer));
        }
      }

      await postTranscript(ctx.discord, channel.id, messageId, text, partCount);
    } catch (err) {
      log.warn("voice-transcription", "Failed: " + String(err));
      await ctx.discord.channels.createMessage(channel.id, {
        content: TRANSCRIPTION_FAILED,
        message_reference: { message_id: messageId },
      });
    }
  },
});
