import { Effect, Schema } from "effect";
import { generateText } from "ai";
import { CLASSIFIER_SYSTEM_PROMPT, ClassifierResponse } from "./prompts.js";
import { ClassifierError } from "./errors.js";

export const classifyRequest = Effect.fn("CodeMode.classifyRequest")(function* (
    messageContent: string,
) {
    const startTime = Date.now();

    const result = yield* Effect.tryPromise({
        try: async () => {
            const response = await generateText({
                model: "anthropic/claude-3.5-haiku",
                system: CLASSIFIER_SYSTEM_PROMPT,
                prompt: `Analyze this Discord message and classify it:\n\n"${messageContent}"\n\nRespond with a JSON object containing:\n- isCodeRequest (boolean)\n- confidence (number 0-1)\n- reason (string)\n\nRespond ONLY with the JSON object, no other text.`,
            });

            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("No JSON found in response");
            }
            const parsed = JSON.parse(jsonMatch[0]);
            return Schema.decodeUnknownSync(ClassifierResponse)(parsed);
        },
        catch: (error) => new ClassifierError({ cause: error }),
    });

    yield* Effect.logDebug("classifier result", {
        is_code_request: result.isCodeRequest,
        confidence: result.confidence,
        reason: result.reason,
        message_preview: messageContent.slice(0, 100),
        duration_ms: Date.now() - startTime,
    });

    return result.isCodeRequest && result.confidence >= 0.7;
});
