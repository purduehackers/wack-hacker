import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { ExecutionResult } from "./executor.js";

export const BUTTON_IDS = {
    APPROVE: "code_mode_approve",
    CANCEL: "code_mode_cancel",
} as const;

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export const createApprovalButtons = (): ActionRowBuilder<ButtonBuilder> => {
    const approveButton = new ButtonBuilder()
        .setCustomId(BUTTON_IDS.APPROVE)
        .setLabel("Approve & Execute")
        .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
        .setCustomId(BUTTON_IDS.CANCEL)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(approveButton, cancelButton);
};

export const createLogsAttachment = (logs: string[]): AttachmentBuilder | null => {
    if (logs.length === 0) return null;
    const content = logs.join("\n");
    const buffer = Buffer.from(content, "utf-8");
    return new AttachmentBuilder(buffer, { name: "logs.txt" });
};

export const createErrorsAttachment = (errors: string[]): AttachmentBuilder | null => {
    if (errors.length === 0) return null;
    const content = errors.join("\n");
    const buffer = Buffer.from(content, "utf-8");
    return new AttachmentBuilder(buffer, { name: "errors.txt" });
};

export const formatCodeBlock = (code: string): string => {
    return `\`\`\`typescript\n${code}\n\`\`\``;
};

export const formatValidationErrors = (
    errors: Array<{ line: number; character: number; message: string }>,
): string => {
    return errors.map((e) => `Line ${e.line}:${e.character} - ${e.message}`).join("\n");
};

export const formatExecutionFooter = (result: ExecutionResult): string => {
    const durationSec = (result.duration_ms / 1000).toFixed(2);
    const status = result.type === "success" ? "successfully" : result.type === "error" ? "with errors" : "timed out";
    return `-# This task ran ${status} in ${durationSec} seconds. It generated ${result.logs.length} logs and ${result.errors.length} errors.`;
};
