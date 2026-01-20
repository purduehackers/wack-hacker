import { Effect } from "effect";
import { generateText, stepCountIs } from "ai";
import type { Guild } from "discord.js";
import { CODE_GENERATOR_SYSTEM_PROMPT } from "./prompts.js";
import { CodeGenerationError } from "./errors.js";
import { createDiscordTools } from "./tools.js";

export const generateCode = Effect.fn("CodeMode.generateCode")(function* (
    userRequest: string,
    guild: Guild,
) {
    const startTime = Date.now();

    yield* Effect.logInfo("generating code with agentic research", {
        request_preview: userRequest.slice(0, 200),
        request_length: userRequest.length,
        guild_id: guild.id,
    });

    const tools = createDiscordTools(guild);

    const result = yield* Effect.tryPromise({
        try: async () => {
            const response = await generateText({
                model: "anthropic/claude-sonnet-4-20250514",
                system: CODE_GENERATOR_SYSTEM_PROMPT,
                prompt: `Request: ${userRequest}

Before generating code, use the research tools to:
1. Search for any roles, channels, or users mentioned in the request
2. Get exact IDs for anything you'll reference in the code
3. Verify entities exist before using them

After research, generate the main() function body code.`,
                tools,
                stopWhen: stepCountIs(8),
            });
            return response.text.trim();
        },
        catch: (error) => new CodeGenerationError({ cause: error }),
    });

    let code = result;
    const codeBlockMatch = code.match(/^```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)\n?```$/m);
    if (codeBlockMatch) {
        code = codeBlockMatch[1].trim();
    }

    yield* Effect.logInfo("code generated", {
        request_preview: userRequest.slice(0, 100),
        code_length: code.length,
        code_lines: code.split("\n").length,
        duration_ms: Date.now() - startTime,
    });

    return code;
});
