import type { Message } from "discord.js";
import type { CommitType } from "./d1";

export interface DetectedCommit {
	type: CommitType;
	evidence: string;
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

function detectGitHubUrl(content: string): string | null {
	for (const pattern of GITHUB_URL_PATTERNS) {
		const match = content.match(pattern);
		if (match) {
			return match[0];
		}
	}
	return null;
}

function hasImage(message: Message): boolean {
	return message.attachments.some(
		(attachment) => attachment.contentType?.startsWith("image/") ?? false,
	);
}

function hasProgressKeywords(content: string): boolean {
	const lowerContent = content.toLowerCase();
	return PROGRESS_KEYWORDS.some((keyword) => lowerContent.includes(keyword));
}

export function detectCommit(message: Message): DetectedCommit | null {
	const content = message.content;

	const githubUrl = detectGitHubUrl(content);
	if (githubUrl) {
		return { type: "github_url", evidence: githubUrl };
	}

	if (hasImage(message)) {
		return { type: "image", evidence: "image attachment" };
	}

	if (content.length >= MIN_PROGRESS_TEXT_LENGTH && hasProgressKeywords(content)) {
		return { type: "progress_text", evidence: content.slice(0, 100) };
	}

	return null;
}
