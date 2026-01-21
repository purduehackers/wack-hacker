import { Duration, Effect, Redacted } from "effect";
import { generateText, experimental_transcribe as transcribe } from "ai";
import { createGroq } from "@ai-sdk/groq";

import { AppConfig } from "../config";
import { AIError, TranscriptionError } from "../errors";

export class AI extends Effect.Service<AI>()("AI", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const groqApiKey = Redacted.value(config.GROQ_API_KEY);

        const groq = createGroq({
            apiKey: groqApiKey,
        });

        const chat = Effect.fn("AI.chat")(function* (options: {
            model?: string;
            systemPrompt: string;
            userPrompt: string;
        }) {
            const model = options.model ?? "llama-3.3-70b-versatile";

            yield* Effect.annotateCurrentSpan({
                model,
                system_prompt_length: options.systemPrompt.length,
                user_prompt_length: options.userPrompt.length,
            });

            yield* Effect.logDebug("ai chat request initiated", {
                service_name: "AI",
                method: "chat",
                operation_type: "api_request",
                model,
                system_prompt_length: options.systemPrompt.length,
                user_prompt_length: options.userPrompt.length,
                api_endpoint: "groq_chat_completions",
            });

            const [duration, result] = yield* Effect.tryPromise({
                try: () =>
                    generateText({
                        model: groq(model),
                        system: options.systemPrompt,
                        prompt: options.userPrompt,
                    }),
                catch: (e) => new AIError({ model, cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);
            const content = result.text;

            if (!content) {
                yield* Effect.logError("ai chat response missing content", {
                    service_name: "AI",
                    method: "chat",
                    operation_type: "api_request",
                    model,
                    duration_ms,
                    latency_ms: duration_ms,
                    error_type: "missing_content",
                    api_endpoint: "groq_chat_completions",
                });

                return yield* Effect.fail(
                    new AIError({
                        model,
                        cause: new Error("No content in response"),
                    }),
                );
            }

            yield* Effect.annotateCurrentSpan({
                response_length: content.length,
                duration_ms,
            });

            yield* Effect.logInfo("ai chat completed", {
                service_name: "AI",
                method: "chat",
                operation_type: "api_request",
                model,
                duration_ms,
                latency_ms: duration_ms,
                response_length: content.length,
                system_prompt_length: options.systemPrompt.length,
                user_prompt_length: options.userPrompt.length,
                api_endpoint: "groq_chat_completions",
                usage_input_tokens: result.usage?.inputTokens,
                usage_output_tokens: result.usage?.outputTokens,
                usage_total_tokens: result.usage?.totalTokens,
            });

            return content;
        });

        const transcribeAudio = Effect.fn("AI.transcribe")(function* (audioUrl: string) {
            yield* Effect.annotateCurrentSpan({
                audio_url: audioUrl,
            });

            yield* Effect.logDebug("ai transcription request initiated", {
                service_name: "AI",
                method: "transcribe",
                operation_type: "audio_transcription",
                audio_url: audioUrl,
                model: "whisper-large-v3",
                language: "en",
                api_endpoint: "groq_audio_transcriptions",
            });

            const audioResponse = yield* Effect.tryPromise({
                try: () => fetch(audioUrl),
                catch: (e) => new TranscriptionError({ cause: e }),
            });

            const blob = yield* Effect.tryPromise({
                try: () => audioResponse.blob(),
                catch: (e) => new TranscriptionError({ cause: e }),
            });

            const audioSize = blob.size;
            const audioBuffer = yield* Effect.tryPromise({
                try: () => blob.arrayBuffer(),
                catch: (e) => new TranscriptionError({ cause: e }),
            });

            const [duration, result] = yield* Effect.tryPromise({
                try: () =>
                    transcribe({
                        model: groq.transcription("whisper-large-v3"),
                        audio: new Uint8Array(audioBuffer),
                        providerOptions: { groq: { language: "en" } },
                    }),
                catch: (e) => new TranscriptionError({ cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            yield* Effect.annotateCurrentSpan({
                transcription_length: result.text.length,
                audio_size_bytes: audioSize,
                duration_ms,
            });

            yield* Effect.logInfo("ai transcription completed", {
                service_name: "AI",
                method: "transcribe",
                operation_type: "audio_transcription",
                audio_url: audioUrl,
                audio_size_bytes: audioSize,
                duration_ms,
                latency_ms: duration_ms,
                transcription_length: result.text.length,
                model: "whisper-large-v3",
                language: "en",
                api_endpoint: "groq_audio_transcriptions",
            });

            return result.text;
        });

        return { chat, transcribe: transcribeAudio } as const;
    }).pipe(Effect.annotateLogs({ service: "AI" })),
}) {}

/** @deprecated Use AI.Default instead */
export const AILive = AI.Default;
