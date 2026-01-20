import type { Message, TextChannel, ThreadChannel } from "discord.js";
import { ComponentType, Events } from "discord.js";
import { Effect, Fiber, Redacted, Schedule } from "effect";

import { AppConfig } from "../../config.js";
import { SUDO_ROLE_ID, INTERNAL_CATEGORIES } from "../../constants.js";
import { DiscordSendError, DiscordThreadError } from "../../errors.js";

import { classifyRequest } from "./classifier.js";
import { generateCode, type StepCallbacks, type GenerationResult } from "./generator.js";
import { generateSummary } from "./summarizer.js";
import { validateCode } from "./validator.js";
import { executeCode } from "./executor.js";
import { buildExecutableScript, type ScriptContext } from "./template.js";
import {
    BUTTON_IDS,
    APPROVAL_TIMEOUT_MS,
    createApprovalButtons,
    createLogsAttachment,
    createErrorsAttachment,
    formatValidationErrors,
    formatExecutionFooter,
    formatStepMessage,
    formatGenerationHeader,
    createCodeDisplay,
} from "./components.js";

export * from "./errors.js";

const WACK_HACKER_BOT_ID = "1115068381649961060";

const TYPING_INTERVAL_MS = 7000;

const withTypingIndicator = <A, E, R>(
    channel: ThreadChannel,
    effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
    const sendTyping = Effect.tryPromise({
        try: () => channel.sendTyping(),
        catch: () => null,
    }).pipe(Effect.ignore);

    const typingLoop = sendTyping.pipe(Effect.repeat(Schedule.spaced(TYPING_INTERVAL_MS)));

    return sendTyping.pipe(
        Effect.andThen(Effect.fork(typingLoop)),
        Effect.flatMap((fiber) => effect.pipe(Effect.ensuring(Fiber.interrupt(fiber).pipe(Effect.ignore)))),
    );
};

type ApprovalResult =
    | { type: "approved" }
    | { type: "cancelled" }
    | { type: "timeout" }
    | { type: "feedback"; feedback: string; feedbackMessage: Message };

const awaitApprovalOrFeedback = (
    statusMessage: Message,
    thread: ThreadChannel,
    authorId: string,
    client: Message["client"],
): Promise<ApprovalResult> => {
    return new Promise((resolve) => {
        let resolved = false;

        const cleanup = () => {
            resolved = true;
            client.off(Events.MessageCreate, messageHandler);
        };

        const messageHandler = (msg: Message) => {
            if (resolved) return;
            if (msg.channelId !== thread.id) return;
            if (msg.author.id !== authorId) return;
            if (msg.author.bot) return;

            cleanup();
            resolve({ type: "feedback", feedback: msg.content, feedbackMessage: msg });
        };

        client.on(Events.MessageCreate, messageHandler);

        statusMessage
            .awaitMessageComponent({
                componentType: ComponentType.Button,
                filter: (i) =>
                    i.user.id === authorId &&
                    (i.customId === BUTTON_IDS.APPROVE || i.customId === BUTTON_IDS.CANCEL),
                time: APPROVAL_TIMEOUT_MS,
            })
            .then((interaction) => {
                if (resolved) return;
                cleanup();
                interaction.deferUpdate().catch(() => {});
                if (interaction.customId === BUTTON_IDS.APPROVE) {
                    resolve({ type: "approved" });
                } else {
                    resolve({ type: "cancelled" });
                }
            })
            .catch(() => {
                if (resolved) return;
                cleanup();
                resolve({ type: "timeout" });
            });
    });
};

const cleanupStepMessages = async (messages: Message[]): Promise<void> => {
    const deletePromises = messages.map(async (msg) => {
        try {
            await msg.delete();
        } catch {
            // Ignore deletion failures (message may already be deleted)
        }
    });
    await Promise.all(deletePromises);
};

export const handleCodeMode = Effect.fn("CodeMode.handle")(
    function* (message: Message) {
        const startTime = Date.now();

        if (message.author.bot) return;
        if (!message.mentions.has(WACK_HACKER_BOT_ID)) return;

        yield* Effect.logInfo("code mode handler triggered", {
            message_id: message.id,
            user_id: message.author.id,
            channel_id: message.channelId,
            content_preview: message.content.slice(0, 100),
        });

        if (message.channel.isThread()) {
            yield* Effect.logDebug("message skipped", {
                reason: "already_in_thread",
                message_id: message.id,
                channel_id: message.channelId,
            });
            return;
        }

        const channel = message.channel as TextChannel;
        const categoryId = channel.parentId ?? channel.parent?.parentId;

        if (!categoryId || !(INTERNAL_CATEGORIES as readonly string[]).includes(categoryId)) {
            yield* Effect.logDebug("message skipped", {
                reason: "not_internal_category",
                message_id: message.id,
                channel_id: channel.id,
                category_id: categoryId ?? "none",
            });
            return;
        }

        if (!message.guild) {
            yield* Effect.logDebug("message skipped", {
                reason: "no_guild",
                message_id: message.id,
            });
            return;
        }

        const member = yield* Effect.tryPromise({
            try: () => message.guild!.members.fetch(message.author.id),
            catch: (cause) => new DiscordSendError({ channelId: message.channelId, cause }),
        });

        if (!member.roles.cache.has(SUDO_ROLE_ID)) {
            yield* Effect.logDebug("message skipped", {
                reason: "missing_sudo_role",
                message_id: message.id,
                user_id: message.author.id,
            });
            return;
        }

        const botMention = `<@${WACK_HACKER_BOT_ID}>`;
        const requestText = message.content.replace(botMention, "").trim();

        if (!requestText) {
            yield* Effect.logDebug("message skipped", {
                reason: "empty_request",
                message_id: message.id,
            });
            return;
        }

        yield* Effect.logInfo("classifying request", {
            message_id: message.id,
            user_id: message.author.id,
            request_preview: requestText.slice(0, 100),
        });

        const isCodeRequest = yield* classifyRequest(requestText);
        if (!isCodeRequest) {
            yield* Effect.logDebug("message skipped", {
                reason: "not_code_request",
                message_id: message.id,
                request_preview: requestText.slice(0, 100),
            });
            return;
        }

        const threadName = `Code Mode: ${requestText.slice(0, 50)}${requestText.length > 50 ? "..." : ""}`;
        const thread = yield* Effect.tryPromise({
            try: () =>
                message.startThread({
                    name: threadName,
                    autoArchiveDuration: 60,
                }),
            catch: (cause) =>
                new DiscordThreadError({
                    channelId: message.channelId,
                    operation: "create_code_mode_thread",
                    cause,
                }),
        });

        yield* Effect.logInfo("thread created", {
            thread_id: thread.id,
            thread_name: threadName,
            message_id: message.id,
        });

        const statusMessage = yield* Effect.tryPromise({
            try: () => thread.send("Please hold!! I write code ✍️"),
            catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
        });

        // Track step messages for cleanup
        let stepMessages: Message[] = [];

        const createStepCallbacks = (): StepCallbacks => ({
            onStepFinish: async (step) => {
                try {
                    const stepMessage = await thread.send(formatStepMessage(step));
                    stepMessages.push(stepMessage);
                } catch {
                    // Ignore send failures - don't break generation for tracking issues
                }
            },
        });

        // Initial code generation with step tracking
        const initialResult = yield* withTypingIndicator(
            thread,
            generateCode(requestText, message.guild!, createStepCallbacks()).pipe(
                Effect.ensuring(
                    Effect.promise(async () => {
                        await cleanupStepMessages(stepMessages);
                        stepMessages = [];
                    }).pipe(Effect.ignore),
                ),
            ),
        );

        let currentCode = initialResult.code;
        let generationHeader = formatGenerationHeader(
            initialResult.totalDurationMs,
            initialResult.toolCallCount,
        );
        let feedbackHistory: string[] = [];

        while (true) {
            const validationResult = yield* validateCode(currentCode);
            if (!validationResult.valid) {
                const errorText = formatValidationErrors(validationResult.errors);
                yield* Effect.tryPromise({
                    try: () =>
                        statusMessage.edit({
                            content: `Code generation failed validation:\n\`\`\`\n${errorText}\n\`\`\``,
                        }),
                    catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
                });

                yield* Effect.logWarning("code validation failed", {
                    message_id: message.id,
                    thread_id: thread.id,
                    error_count: validationResult.errors.length,
                    duration_ms: Date.now() - startTime,
                });
                return;
            }

            const codeDisplay = createCodeDisplay(
                currentCode,
                generationHeader,
                `<@${message.author.id}> Please review this code before I execute it:`,
            );

            yield* Effect.tryPromise({
                try: () =>
                    statusMessage.edit({
                        content: codeDisplay.content,
                        components: [createApprovalButtons()],
                        files: [codeDisplay.file],
                    }),
                catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
            });

            yield* Effect.logInfo("code presented for approval", {
                message_id: message.id,
                thread_id: thread.id,
                code_length: currentCode.length,
                feedback_rounds: feedbackHistory.length,
            });

            const approvalResult = yield* Effect.tryPromise({
                try: () => awaitApprovalOrFeedback(statusMessage, thread, message.author.id, message.client),
                catch: () => ({ type: "timeout" }) as ApprovalResult,
            });

            if (approvalResult.type === "timeout") {
                const timeoutDisplay = createCodeDisplay(
                    currentCode,
                    generationHeader,
                    `<@${message.author.id}> Please review this code before I execute it:`,
                    "**Approval timed out.**",
                );

                yield* Effect.tryPromise({
                    try: () =>
                        statusMessage.edit({
                            content: timeoutDisplay.content,
                            components: [],
                            files: [timeoutDisplay.file],
                        }),
                    catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
                });

                yield* Effect.logInfo("approval timed out", {
                    message_id: message.id,
                    thread_id: thread.id,
                    duration_ms: Date.now() - startTime,
                });
                return;
            }

            if (approvalResult.type === "cancelled") {
                const cancelDisplay = createCodeDisplay(
                    currentCode,
                    generationHeader,
                    `<@${message.author.id}> Please review this code before I execute it:`,
                    "**Cancelled by user.**",
                );

                yield* Effect.tryPromise({
                    try: () =>
                        statusMessage.edit({
                            content: cancelDisplay.content,
                            components: [],
                            files: [cancelDisplay.file],
                        }),
                    catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
                });

                yield* Effect.logInfo("execution cancelled", {
                    message_id: message.id,
                    thread_id: thread.id,
                    duration_ms: Date.now() - startTime,
                });
                return;
            }

            if (approvalResult.type === "approved") {
                break;
            }

            if (approvalResult.type === "feedback") {
                yield* Effect.logInfo("received feedback", {
                    message_id: message.id,
                    thread_id: thread.id,
                    feedback_preview: approvalResult.feedback.slice(0, 100),
                    feedback_round: feedbackHistory.length + 1,
                });

                yield* Effect.tryPromise({
                    try: () => approvalResult.feedbackMessage.react("👍"),
                    catch: () => null,
                });

                yield* Effect.tryPromise({
                    try: () =>
                        statusMessage.edit({
                            content: `**Regenerating based on your feedback...**`,
                            components: [],
                            files: [],
                        }),
                    catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
                });

                feedbackHistory.push(approvalResult.feedback);

                const feedbackContext = feedbackHistory
                    .map((f, i) => `Feedback ${i + 1}: ${f}`)
                    .join("\n");

                const enhancedRequest = `Original request: ${requestText}

Previous code that needs changes:
\`\`\`typescript
${currentCode}
\`\`\`

User feedback to incorporate:
${feedbackContext}

Generate updated code that addresses the feedback while still fulfilling the original request.`;

                // Regenerate code with step tracking
                const feedbackResult = yield* withTypingIndicator(
                    thread,
                    generateCode(enhancedRequest, message.guild!, createStepCallbacks()).pipe(
                        Effect.ensuring(
                            Effect.promise(async () => {
                                await cleanupStepMessages(stepMessages);
                                stepMessages = [];
                            }).pipe(Effect.ignore),
                        ),
                    ),
                );

                currentCode = feedbackResult.code;
                generationHeader = formatGenerationHeader(
                    feedbackResult.totalDurationMs,
                    feedbackResult.toolCallCount,
                );

                // Add check mark to indicate feedback was implemented
                yield* Effect.tryPromise({
                    try: () => approvalResult.feedbackMessage.react("✅"),
                    catch: () => null,
                });
            }
        }

        const executingMessage = yield* Effect.tryPromise({
            try: () => thread.send("Beeping the boops and running the code... 🤖"),
            catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
        });

        const finalCodeDisplay = createCodeDisplay(
            currentCode,
            generationHeader,
            `<@${message.author.id}> Please review this code before I execute it:`,
        );

        yield* Effect.tryPromise({
            try: () =>
                statusMessage.edit({
                    content: finalCodeDisplay.content,
                    components: [],
                    files: [finalCodeDisplay.file],
                }),
            catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
        });

        const config = yield* AppConfig;

        const scriptContext: ScriptContext = {
            botToken: Redacted.value(config.DISCORD_BOT_TOKEN),
            guildId: message.guildId!,
            channelId: message.channelId,
            messageId: message.id,
            authorId: message.author.id,
        };

        const fullScript = buildExecutableScript(currentCode, scriptContext);
        const executionResult = yield* withTypingIndicator(thread, executeCode(fullScript));

        const summary = yield* generateSummary(
            requestText,
            executionResult.logs,
            executionResult.errors,
            executionResult.type === "success",
        );

        const footer = formatExecutionFooter(executionResult);
        const logsAttachment = createLogsAttachment([...executionResult.logs]);
        const errorsAttachment = createErrorsAttachment([...executionResult.errors]);

        const files = [logsAttachment, errorsAttachment].filter(
            (f): f is NonNullable<typeof f> => f !== null,
        );

        yield* Effect.tryPromise({
            try: () =>
                executingMessage.edit({
                    content: `<@${message.author.id}> ${summary}\n\n${footer}`,
                    files,
                }),
            catch: (cause) => new DiscordSendError({ channelId: thread.id, cause }),
        });

        yield* Effect.logInfo("code execution completed", {
            message_id: message.id,
            thread_id: thread.id,
            user_id: message.author.id,
            result_type: executionResult.type,
            log_count: executionResult.logs.length,
            error_count: executionResult.errors.length,
            feedback_rounds: feedbackHistory.length,
            execution_duration_ms: executionResult.duration_ms,
            total_duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "code_mode" }),
);
