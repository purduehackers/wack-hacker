import { groq } from "@ai-sdk/groq";
import { experimental_transcribe as transcribe } from "ai";
import { MessageFlags } from "discord.js";
import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";

const TRANSCRIPTION_FAILED = "Sorry, I couldn't transcribe that audio message.";

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

      const result = await transcribe({
        model: groq.transcription("whisper-large-v3"),
        audio: buffer,
        providerOptions: {
          groq: { language: "en" },
        },
      });

      await ctx.discord.channels.createMessage(channel.id, {
        content: result.text || TRANSCRIPTION_FAILED,
        message_reference: { message_id: messageId },
      });
    } catch (err) {
      log.warn("voice-transcription", `Failed: ${String(err)}`);
      await ctx.discord.channels.createMessage(channel.id, {
        content: TRANSCRIPTION_FAILED,
        message_reference: { message_id: messageId },
      });
    }
  },
});
