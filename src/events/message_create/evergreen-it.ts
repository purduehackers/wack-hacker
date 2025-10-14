import type { Message } from "discord.js";

import { BISHOP_ROLE_ID, EVERGREEN_CREATE_ISSUE_STRING, ORGANIZER_ROLE_ID } from "../../utils/consts";
import { createGithubIssue, getAssociationsFile } from "../../utils/github";
import { appendMediaWikiPage } from "../../utils/mediawiki";

export default async function handler(message: Message) {
	if (message.author.bot) return;
	if (message.channel.isDMBased()) return;

	if (!message.member?.roles.cache.some((r) => r.id === ORGANIZER_ROLE_ID || r.id === BISHOP_ROLE_ID)) {
		return;
	}

	if (!message.content.toLowerCase().startsWith(EVERGREEN_CREATE_ISSUE_STRING)) {
		return;
	}

	let original: Message;

	if (!message.reference || !message.reference.messageId) {
		const messages = await message.channel.messages.fetch({ limit: 2 });
		const [_, ref:Message] = Array.from(messages.values());
		original = ref;
	} else {
		original = await message.channel.messages.fetch(
			message.reference?.messageId,
		);
	}

	if (!original) return;

	const mediaUrl = await handle_mediawiki(original, message);
	const githubUrl = await handle_github(original, message);

	//hacky but oh well
	await message.reply(`Created [github issue](${githubUrl}) and [mediawiki issue](${mediaUrl})!`);
}

async function handle_github(original:Message, message:Message) {
	//getting the github handles for people
	const people = await getAssociationsFile();
	const assignees: string[] = [
		people[message.author.id],
		people[original.author.id],
	].filter(Boolean);
	const originalAuthor = people[original.author.id] ?? original.author.tag;
	const requestor = people[message.author.id] ?? message.author.tag;

	const originalText = original.content;
	const messageArgs = message.content.slice(EVERGREEN_CREATE_ISSUE_STRING.length);
	const messageLink = message.url;
	const channelName = message.channel.name;

	const pretitle = (messageArgs.length > 0) ? 
		`${messageArgs.slice(1)} -` : 
		`Evergreen request from`;
	const title = `${pretitle} @${requestor} in #${channelName}`.slice(0, 255); // Limit to accommodate Github's Issue Title Length Limit

	const body = `**@${originalAuthor}**[^1] said in **[#${channelName}](<${messageLink}>)**:\n\n`
		+`${originalText
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n")}\n\n`
		+`[^1]: @${requestor} please edit this issue to include any additional context or details you think are necessary, `
		+`and/or assign it to someone else if you would not want to do it.`;

	const { html_url } = await createGithubIssue(title, body, assignees);
	return html_url;
}

async function handle_mediawiki(original:Message, message:Message) {
	const pageTarget = `Evergreen It`;
	const originalText = original.content;
	const originalAuthor = original.author.tag;
	const messageArgs = message.content.slice(EVERGREEN_CREATE_ISSUE_STRING.length);
	const messageLink = message.url;
	// const requestor = message.author.tag;
	const channelName = message.channel.name;

	let now = new Date();
	let months = [`Jan`,`Feb`,`Mar`,`Apr`,`May`,`Jun`,`Jul`,`Aug`,`Sep`,`Oct`,`Nov`,`Dec`];

	const userTitle = (messageArgs.length > 0) ? 
		messageArgs.slice(1) : 
		originalText.slice(0, 90);
	const title = `in #${channelName} - ${userTitle}`;

	const body = `\n\n* [${messageLink} @${originalAuthor} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}]: ${title}`;

	const { result } = await appendMediaWikiPage(pageTarget, body, "Wack Hacker - added issue");
	if (result != `Success`) {
		return;
	}
	//hacky but oh well
	return `https://evergreen.skywiki.org/wiki/${pageTarget}`;
}
