/**
 * @fileoverview Transcribes Discord voice messages with Whisper.
 *
 * The interesting part is size. Whisper rejects uploads past a limit that
 * Discord voice messages can exceed. The transcriber splits anything large
 * into several valid Ogg Opus streams and transcribes them in parallel.
 *
 * Two behaviours carried over deliberately:
 *
 * - **Partial results beat no result.** If one chunk fails after a retry, its
 *   place is held by a `[part n/m failed]` marker and the rest is still posted.
 *   A forty-minute recording losing thirty seconds is far better than losing all
 *   of it.
 * - **The fast path can fall back.** A file under the threshold goes up whole,
 *   but Whisper's limit is not exactly ours, so a size complaint on that path
 *   retries as chunks rather than giving up.
 */

import { createGroq } from "@ai-sdk/groq";
import { messageOf } from "@repo/shared/errors";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { splitWithFooter } from "@repo/shared/text";
import { transcribe } from "ai";
import { MessageFlags } from "discord.js";
import type { Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import { splitOggOpus } from "../utils/audio.ts";

const MICROPHONE = "\u{1F399}\u{FE0F}";
const FAILED_NOTICE = "Sorry, I couldn't transcribe that audio message.";

/** Above this, split before trying. Below it, try whole and fall back. */
const CHUNK_THRESHOLD_BYTES = 24 * 1024 * 1024;
const CHUNK_TARGET_BYTES = 20 * 1024 * 1024;
const CHUNK_RETRY_DELAY_MS = 750;

/** Whisper's size complaints, which arrive as prose rather than a status. */
const TOO_LARGE_PATTERN = /\b413\b|too large|payload|exceeds|size limit|too big/i;

export interface TranscriberDeps {
  readonly apiKey: string;
}

/**
 * Builds a Whisper transcriber bound to one Groq API key.
 *
 * The returned `transcribe` never rejects: upstream failures come back as a
 * `Transient` error, so the caller never needs a try/catch. A partly failed
 * chunked run still returns text with inline failure markers.
 */
export function createTranscriber(deps: TranscriberDeps) {
  const groq = createGroq({ apiKey: deps.apiKey });

  const once = async (audio: Uint8Array): Promise<string> => {
    const result = await transcribe({
      model: groq.transcription("whisper-large-v3-turbo"),
      audio,
      providerOptions: { groq: { language: "en" } },
    });
    return result.text;
  };

  /** Transcribes every chunk concurrently, tolerating individual failures. */
  const chunked = async (
    buffer: Uint8Array,
  ): Promise<Result<{ text: string; partCount: number }, Transient>> => {
    const split = splitOggOpus(buffer, { targetBytes: CHUNK_TARGET_BYTES });
    if (Result.isError(split)) {
      return Result.err(new Transient({ operation: "split audio", detail: split.error.message }));
    }

    const audioSegments = split.value;
    const settled = await Promise.all(
      audioSegments.map(async (segment, index) => {
        try {
          return await once(segment);
        } catch {
          // One retry: these failures are usually transient upstream capacity.
          await new Promise<void>((r) => setTimeout(r, CHUNK_RETRY_DELAY_MS));
          try {
            return await once(segment);
          } catch (cause) {
            console.warn(`transcription chunk ${index + 1}/${audioSegments.length} failed`, cause);
            return undefined;
          }
        }
      }),
    );

    if (settled.every((part) => part === undefined)) {
      return Result.err(
        new Transient({ operation: "transcribe audio", detail: "every chunk failed" }),
      );
    }

    const text = settled
      .map((part, index) => part ?? `[part ${index + 1}/${audioSegments.length} failed]`)
      .join(" ")
      .trim();

    return Result.ok({ text, partCount: audioSegments.length });
  };

  return {
    transcribe: async (
      buffer: Uint8Array,
    ): Promise<Result<{ text: string; partCount: number }, Transient>> => {
      if (buffer.byteLength > CHUNK_THRESHOLD_BYTES) return chunked(buffer);

      const whole = await Result.tryPromise({
        try: () => once(buffer),
        catch: (cause) => cause,
      });
      if (Result.isOk(whole)) return Result.ok({ text: whole.value, partCount: 1 });

      // Our threshold is a guess at Whisper's. When it disagrees, chunk.
      if (TOO_LARGE_PATTERN.test(String(whole.error))) return chunked(buffer);

      return Result.err(
        new Transient({
          operation: "transcribe audio",
          detail: messageOf(whole.error),
        }),
      );
    },
  };
}

export type Transcriber = ReturnType<typeof createTranscriber>;

/** Posts the transcript as a reply, split across messages when long. */
async function postTranscript(message: Message, text: string, partCount: number): Promise<void> {
  const footer = partCount > 1 ? `\n-# Transcribed in ${partCount} parts` : "";
  const bodies = splitWithFooter(text === "" ? FAILED_NOTICE : text, footer);

  for (const [index, body] of bodies.entries()) {
    // Only the first message replies, so a long transcript does not produce a
    // stack of reply arrows all pointing at the same voice note. The rest go to
    // the channel, which needs the send-capable narrowing.
    if (index === 0 || !message.channel.isSendable()) await message.reply(body);
    else await message.channel.send(body);
  }
}

/**
 * Binds the transcriber into a message event. Deduplicates on message id and
 * ignores bot mentions, because a mention starts an agent turn rather than a
 * plain transcription.
 */
export function transcribeVoiceMessage(transcriber: Transcriber) {
  return defineEvent({
    name: "transcribe-voice-message",
    kind: "message",
    dedupKey: (message) => message.id,
    handle: async (message, context) => {
      if (context.isBotMention) return Result.ok(undefined);
      if (!message.flags.has(MessageFlags.IsVoiceMessage)) return Result.ok(undefined);

      const audio = [...message.attachments.values()].find((a) => a.name.endsWith(".ogg"));
      if (audio === undefined) return Result.ok(undefined);

      // Immediate acknowledgement: transcription can take a while, and silence
      // reads as the bot having missed it.
      await message.react(MICROPHONE);

      const downloaded = await Result.tryPromise({
        try: async () => new Uint8Array(await (await fetch(audio.url)).arrayBuffer()),
        catch: (cause) =>
          new Transient({
            operation: "download voice message",
            detail: messageOf(cause),
          }),
      });
      if (Result.isError(downloaded)) {
        await message.reply(FAILED_NOTICE);
        return Result.err(downloaded.error);
      }

      const transcript = await transcriber.transcribe(downloaded.value);
      if (Result.isError(transcript)) {
        await message.reply(FAILED_NOTICE);
        return Result.err(transcript.error);
      }

      await postTranscript(message, transcript.value.text, transcript.value.partCount);
      return Result.ok(undefined);
    },
  });
}
