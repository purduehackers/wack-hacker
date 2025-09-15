import type { Message } from "discord.js";
import {
	downloadImageFromUrl,
	generateEventSlug,
	isImageUploaded,
	updateEventIndex,
	uploadImageToR2,
} from "../../utils/r2";

export default async function hackNightImages(message: Message) {
	if (message.author.bot) return;

	if (!message.channel.isThread()) return;

	if (!message.channel.name.startsWith("Hack Night Images - ")) return;

	if (message.attachments.size === 0) return;

	const threadStartDate = message.channel.createdAt;
	if (!threadStartDate) return;

	const eventSlug = generateEventSlug(threadStartDate);

	const alreadyUploaded = await isImageUploaded(eventSlug, message.id);
	if (alreadyUploaded) return;

	try {
		for (const attachment of message.attachments.values()) {
			if (!attachment.contentType?.startsWith("image/")) continue;

			const imageBuffer = await downloadImageFromUrl(attachment.url);
			const filename = `${Bun.randomUUIDv7()}.jpg`;

			await uploadImageToR2(imageBuffer, eventSlug, filename);

			const imageMetadata = {
				filename,
				uploadedAt: new Date().toISOString(),
				discordMessageId: message.id,
				discordUserId: message.author.id,
			};

			await updateEventIndex(eventSlug, imageMetadata);

			console.log(`Uploaded image: ${filename} for event: ${eventSlug}`);
		}

		await message.react("✅");
	} catch (error) {
		console.error("Error uploading images to R2:", error);
		await message.react("❌");
	}
}
