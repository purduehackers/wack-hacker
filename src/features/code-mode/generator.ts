import { Effect } from "effect";
import { generateText, stepCountIs } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import type { Guild } from "discord.js";
import { CODE_GENERATOR_SYSTEM_PROMPT } from "./prompts.js";
import { CodeGenerationError } from "./errors.js";
import { createDiscordTools } from "./tools.js";
import { AppConfig } from "../../config.js";
import { Redacted } from "effect";

export interface StepInfo {
  type: "tool_call" | "text";
  content: string;
}

export interface GenerationResult {
  code: string;
  totalDurationMs: number;
  toolCallCount: number;
}

export interface StepCallbacks {
  onStepFinish: (step: StepInfo) => Promise<void>;
}

const formatToolInput = (toolName: string, args: unknown): string => {
  const a = (args ?? {}) as Record<string, unknown>;

  // Get first string value from args as a fallback
  const firstValue = Object.values(a).find((v) => typeof v === "string") as
    | string
    | undefined;

  try {
    const toolDisplayNames: Record<
      string,
      (args: Record<string, unknown>) => string
    > = {
      // Discord inspection tools
      searchRoles: (a) =>
        `Searching roles for: "${a.pattern ?? firstValue ?? "..."}"`,
      searchChannels: (a) =>
        `Searching channels for: "${a.pattern ?? firstValue ?? "..."}"${a.type ? ` (${a.type})` : ""}`,
      getRoleInfo: (a) =>
        `Getting role info: "${a.identifier ?? firstValue ?? "..."}"`,
      getChannelInfo: (a) =>
        `Getting channel info: "${a.identifier ?? firstValue ?? "..."}"`,
      getRoleMembers: (a) =>
        `Getting role members: ${a.roleId ?? firstValue ?? "..."}`,
      countMembersByJoinDate: (a) =>
        `Counting members joined after: ${a.after ?? firstValue ?? "..."}`,
      listRoles: () => `Listing server roles`,
      searchUsers: (a) =>
        `Searching users for: "${a.pattern ?? firstValue ?? "..."}"`,
      // Context7 documentation tools
      "resolve-library-id": (a) =>
        `Finding library: "${a.libraryName ?? firstValue ?? "..."}"`,
      "get-library-docs": (a) =>
        `Looking up docs: "${a.topic ?? firstValue ?? "..."}"`,
    };

    const formatter = toolDisplayNames[toolName];
    if (formatter) {
      const result = formatter(a);
      // If result still has "..." and we have args, show a summary
      if (result.includes("...") && Object.keys(a).length > 0) {
        const summary = JSON.stringify(a);
        if (summary.length < 80) {
          return `${toolName}: ${summary}`;
        }
      }
      return result;
    }
  } catch {
    // Fall through to default
  }

  // Default: show tool name with args summary if available
  if (Object.keys(a).length > 0) {
    const summary = JSON.stringify(a);
    if (summary.length < 100) {
      return `${toolName}: ${summary}`;
    }
  }
  return `Running: ${toolName}`;
};

export const generateCode = Effect.fn("CodeMode.generateCode")(function* (
  userRequest: string,
  guild: Guild,
  callbacks?: StepCallbacks,
): Generator<unknown, GenerationResult, unknown> {
  const startTime = Date.now();
  let toolCallCount = 0;

  yield* Effect.logInfo("generating code with agentic research", {
    request_preview: userRequest.slice(0, 200),
    request_length: userRequest.length,
    guild_id: guild.id,
  });

  const discordTools = createDiscordTools(guild);

  // Get Context7 API key from config
  const config = yield* AppConfig;
  const context7ApiKey = Redacted.value(config.CONTEXT7_API_KEY);

  const result = yield* Effect.tryPromise({
    try: async () => {
      // Try to create MCP client for Context7 documentation (optional)
      let context7Client: Awaited<ReturnType<typeof createMCPClient>> | null =
        null;
      let documentationTools: Record<string, unknown> = {};

      try {
        context7Client = await createMCPClient({
          transport: {
            type: "sse",
            url: "https://mcp.context7.com/sse",
            headers: {
              Authorization: `Bearer ${context7ApiKey}`,
            },
          },
        });
        documentationTools = await context7Client.tools();
      } catch (e) {
        // Context7 unavailable - continue without documentation tools
        console.warn("Context7 MCP unavailable, continuing without docs:", e);
      }

      const tools = { ...discordTools, ...documentationTools };
      const hasDocTools = Object.keys(documentationTools).length > 0;

      try {
        const response = await generateText({
          model: "anthropic/claude-opus-4.5",
          system: CODE_GENERATOR_SYSTEM_PROMPT,
          prompt: `Request: ${userRequest}

Before generating code, use the research tools to:
1. Search for any roles, channels, or users mentioned in the request
2. Get exact IDs for anything you'll reference in the code
3. Verify entities exist before using them
${hasDocTools ? "4. If you need to look up Discord.js API methods, use resolve-library-id to find \"discord.js\" then get-library-docs to look up the correct API" : ""}

After research, generate the main() function body code.`,
          tools,
          stopWhen: stepCountIs(8),
          onStepFinish: async (event) => {
            // Handle reasoning/thinking text first (appears before tool calls)
            // Show text if: has tool calls (reasoning before tools), or is intermediate step
            const hasToolCalls = event.toolCalls && event.toolCalls.length > 0;
            const isIntermediateText =
              event.text && event.text.trim() && event.isContinued;
            const isReasoningWithTools =
              event.text && event.text.trim() && hasToolCalls;

            if (
              (isIntermediateText || isReasoningWithTools) &&
              callbacks?.onStepFinish
            ) {
              await callbacks.onStepFinish({
                type: "text",
                content: event.text.trim(),
              });
            }

            // Handle tool calls
            if (hasToolCalls) {
              for (const toolCall of event.toolCalls) {
                toolCallCount++;
                if (callbacks?.onStepFinish) {
                  const formattedInput = formatToolInput(
                    toolCall.toolName,
                    toolCall.args,
                  );
                  await callbacks.onStepFinish({
                    type: "tool_call",
                    content: formattedInput,
                  });
                }
              }
            }
          },
        });
        return response.text.trim();
      } finally {
        // Close the MCP client if it was created
        if (context7Client) {
          await context7Client.close();
        }
      }
    },
    catch: (error) => new CodeGenerationError({ cause: error }),
  });

  let code = result;
  const codeBlockMatch = code.match(
    /^```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)\n?```$/m,
  );
  if (codeBlockMatch) {
    code = codeBlockMatch[1].trim();
  }

  const totalDurationMs = Date.now() - startTime;

  yield* Effect.logInfo("code generated", {
    request_preview: userRequest.slice(0, 100),
    code_length: code.length,
    code_lines: code.split("\n").length,
    duration_ms: totalDurationMs,
    tool_call_count: toolCallCount,
  });

  return {
    code,
    totalDurationMs,
    toolCallCount,
  };
});
