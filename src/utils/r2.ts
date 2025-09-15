import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { env } from "../env";

const s3Client = new S3Client({
	region: "auto",
	endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
	},
});

export interface ImageMetadata {
	filename: string;
	uploadedAt: string;
	discordMessageId: string;
	discordUserId: string;
}

export interface EventIndex {
	eventSlug: string;
	lastUpdated: string;
	images: ImageMetadata[];
}

export function generateEventSlug(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `hack-night-${year}-${month}-${day}`;
}

export async function uploadImageToR2(
	imageBuffer: Buffer,
	eventSlug: string,
	filename: string,
): Promise<string> {
	const processedBuffer = await sharp(imageBuffer).jpeg().toBuffer();

	const key = `images/${eventSlug}/${filename}`;

	await s3Client.send(
		new PutObjectCommand({
			Bucket: env.R2_BUCKET_NAME,
			Key: key,
			Body: processedBuffer,
			ContentType: "image/jpeg",
		}),
	);

	return key;
}

export async function getEventIndex(
	eventSlug: string,
): Promise<EventIndex | null> {
	try {
		const key = `images/${eventSlug}/index.json`;
		const response = await s3Client.send(
			new GetObjectCommand({
				Bucket: env.R2_BUCKET_NAME,
				Key: key,
			}),
		);

		if (!response.Body) {
			return null;
		}

		const bodyString = await response.Body.transformToString();
		return JSON.parse(bodyString) as EventIndex;
	} catch (error) {
		if ((error as any)?.name === "NoSuchKey") {
			return null;
		}
		throw error;
	}
}

export async function updateEventIndex(
	eventSlug: string,
	newImage: ImageMetadata,
): Promise<void> {
	let index = await getEventIndex(eventSlug);

	if (!index) {
		index = {
			eventSlug,
			lastUpdated: new Date().toISOString(),
			images: [],
		};
	}

	index.images.push(newImage);
	index.lastUpdated = new Date().toISOString();

	const key = `images/${eventSlug}/index.json`;

	await s3Client.send(
		new PutObjectCommand({
			Bucket: env.R2_BUCKET_NAME,
			Key: key,
			Body: JSON.stringify(index, null, 2),
			ContentType: "application/json",
		}),
	);
}

export async function isImageUploaded(
	eventSlug: string,
	discordMessageId: string,
): Promise<boolean> {
	const index = await getEventIndex(eventSlug);
	if (!index) {
		return false;
	}

	return index.images.some((img) => img.discordMessageId === discordMessageId);
}

export async function downloadImageFromUrl(url: string): Promise<Buffer> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.statusText}`);
	}
	return Buffer.from(await response.arrayBuffer());
}
