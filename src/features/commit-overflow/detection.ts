import type { Collection, Attachment } from "discord.js";

import type { CommitType } from "../../db/schema";

export interface DetectedCommit {
    type: CommitType;
    evidence: string;
    metrics: {
        content_length: number;
        attachment_count: number;
        image_count: number;
    };
}

export interface CommitDetectionMessage {
    content: string | null;
    attachments: Collection<string, Attachment>;
}

const GITHUB_URL_PATTERNS = [
    /github\.com\/[\w-]+\/[\w-]+\/commit\/[a-f0-9]{7,40}/i,
    /github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/i,
    /github\.com\/[\w-]+\/[\w-]+\/compare\//i,
    /github\.com\/[\w-]+\/[\w-]+\/blob\//i,
    /github\.com\/[\w-]+\/[\w-]+\/tree\//i,
];

const PROGRESS_KEYWORDS = [
    "added",
    "fixed",
    "implemented",
    "updated",
    "built",
    "created",
    "finished",
    "working on",
    "progress",
    "completed",
    "started",
    "refactored",
    "deployed",
    "pushed",
    "merged",
    "shipped",
];

const MIN_PROGRESS_TEXT_LENGTH = 20;

const detectGitHubUrl = (content: string): string | null => {
    for (const pattern of GITHUB_URL_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
            return match[0];
        }
    }
    return null;
};

const hasImage = (message: CommitDetectionMessage): boolean => {
    return message.attachments.some(
        (attachment) => attachment.contentType?.startsWith("image/") ?? false,
    );
};

const hasProgressKeywords = (content: string): boolean => {
    const lowerContent = content.toLowerCase();
    return PROGRESS_KEYWORDS.some((keyword) => lowerContent.includes(keyword));
};

export const detectCommit = (message: CommitDetectionMessage): DetectedCommit | null => {
    const content = message.content ?? "";
    const contentLength = content.length;
    const attachmentCount = message.attachments.size;
    const imageCount = message.attachments.filter(
        (attachment) => attachment.contentType?.startsWith("image/") ?? false
    ).size;

    const metrics = {
        content_length: contentLength,
        attachment_count: attachmentCount,
        image_count: imageCount,
    };

    const githubUrl = detectGitHubUrl(content);
    if (githubUrl) {
        return { type: "github_url", evidence: githubUrl, metrics };
    }

    if (hasImage(message)) {
        return { type: "image", evidence: "image attachment", metrics };
    }

    if (content.length >= MIN_PROGRESS_TEXT_LENGTH && hasProgressKeywords(content)) {
        return { type: "progress_text", evidence: content.slice(0, 100), metrics };
    }

    return null;
};
