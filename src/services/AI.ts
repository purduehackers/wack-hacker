import { Duration, Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { AIError, TranscriptionError } from "../errors";

export class AI extends Effect.Service<AI>()("AI", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const groqApiKey = Redacted.value(config.GROQ_API_KEY);

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

            const [duration, response] = yield* Effect.tryPromise({
                try: () =>
                    fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${groqApiKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model,
                            messages: [
                                { role: "system", content: options.systemPrompt },
                                { role: "user", content: options.userPrompt },
                            ],
                        }),
                    }),
                catch: (e) => new AIError({ model, cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            if (!response.ok) {
                const text = yield* Effect.tryPromise({
                    try: () => response.text(),
                    catch: (e) => new AIError({ model, cause: e }),
                });

                yield* Effect.logError("ai chat request failed", {
                    service_name: "AI",
                    method: "chat",
                    operation_type: "api_request",
                    model,
                    http_status: response.status,
                    error_message: text,
                    duration_ms,
                    latency_ms: duration_ms,
                    api_endpoint: "groq_chat_completions",
                });

                return yield* Effect.fail(new AIError({ model, cause: new Error(text) }));
            }

            const data = yield* Effect.tryPromise({
                try: () =>
                    response.json() as Promise<{
                        choices: { message: { content: string } }[];
                    }>,
                catch: (e) => new AIError({ model, cause: e }),
            });

            const content = data.choices[0]?.message?.content;
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
                http_status: response.status,
            });

            return content;
        });

        const transcribe = Effect.fn("AI.transcribe")(function* (audioUrl: string) {
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

            const formData = new FormData();
            formData.append("file", blob, "audio.ogg");
            formData.append("model", "whisper-large-v3");
            formData.append("language", "en");

            const [duration, response] = yield* Effect.tryPromise({
                try: () =>
                    fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${groqApiKey}`,
                        },
                        body: formData,
                    }),
                catch: (e) => new TranscriptionError({ cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            if (!response.ok) {
                const text = yield* Effect.tryPromise({
                    try: () => response.text(),
                    catch: (e) => new TranscriptionError({ cause: e }),
                });

                yield* Effect.logError("ai transcription request failed", {
                    service_name: "AI",
                    method: "transcribe",
                    operation_type: "audio_transcription",
                    audio_url: audioUrl,
                    audio_size_bytes: audioSize,
                    http_status: response.status,
                    error_message: text,
                    duration_ms,
                    latency_ms: duration_ms,
                    model: "whisper-large-v3",
                    api_endpoint: "groq_audio_transcriptions",
                });

                return yield* Effect.fail(new TranscriptionError({ cause: new Error(text) }));
            }

            const data = yield* Effect.tryPromise({
                try: () => response.json() as Promise<{ text: string }>,
                catch: (e) => new TranscriptionError({ cause: e }),
            });

            yield* Effect.annotateCurrentSpan({
                transcription_length: data.text.length,
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
                transcription_length: data.text.length,
                model: "whisper-large-v3",
                language: "en",
                http_status: response.status,
                api_endpoint: "groq_audio_transcriptions",
            });

            return data.text;
        });

        return { chat, transcribe } as const;
    }).pipe(Effect.annotateLogs({ service: "AI" })),
}) {}

/** @deprecated Use AI.Default instead */
export const AILive = AI.Default;
