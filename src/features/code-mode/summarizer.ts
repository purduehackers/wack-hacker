import { Effect } from "effect";
import { generateText } from "ai";
import { CodeGenerationError } from "./errors.js";

const SUMMARY_SYSTEM_PROMPT = `You are summarizing the results of code execution for a Discord bot.

Given the user's original request and the execution logs, write a brief summary addressing what was accomplished.

Rules:
- Be concise (1-3 sentences)
- Address the user's original question directly
- If the task succeeded, summarize the key findings or actions taken
- If there were errors, briefly explain what went wrong
- Use casual, friendly tone
- Don't mention technical details like "logs" or "execution" - just summarize the outcome
- Start with a lowercase letter (e.g., "found 72 roles..." not "Found 72 roles...")`;

export const generateSummary = Effect.fn("CodeMode.generateSummary")(function* (
    originalRequest: string,
    logs: string[],
    errors: string[],
    success: boolean,
) {
    const startTime = Date.now();

    const logsPreview = logs.slice(0, 100).join("\n");
    const errorsPreview = errors.slice(0, 20).join("\n");

    const result = yield* Effect.tryPromise({
        try: async () => {
            const response = await generateText({
                model: "anthropic/claude-3.5-haiku",
                system: SUMMARY_SYSTEM_PROMPT,
                prompt: `Original request: "${originalRequest}"

Execution ${success ? "succeeded" : "failed"}.

Logs:
${logsPreview || "(no logs)"}

${errorsPreview ? `Errors:\n${errorsPreview}` : ""}

Write a brief summary addressing the user's request:`,
            });
            return response.text.trim();
        },
        catch: (error) => new CodeGenerationError({ cause: error }),
    });

    yield* Effect.logDebug("summary generated", {
        request_preview: originalRequest.slice(0, 100),
        summary_length: result.length,
        duration_ms: Date.now() - startTime,
    });

    return result;
});
