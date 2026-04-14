import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { log } from "evlog";

import type { EventIndex, ImageMetadata } from "./types";

export class R2Storage {
  private s3: S3Client;

  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private defaultBucket: string,
  ) {
    this.s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async uploadBuffer(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
    bucket?: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket ?? this.defaultBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async downloadBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error("R2 download failed");
    return Buffer.from(await res.arrayBuffer());
  }

  async getJSON<T>(key: string, bucket?: string): Promise<T | null> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket ?? this.defaultBucket, Key: key }),
      );
      if (!res.Body) return null;
      return JSON.parse(await res.Body.transformToString()) as T;
    } catch (err) {
      if ((err as { name?: string })?.name === "NoSuchKey") return null;
      throw err;
    }
  }

  async putJSON(key: string, data: unknown, bucket?: string): Promise<void> {
    await this.uploadBuffer(
      key,
      Buffer.from(JSON.stringify(data, null, 2)),
      "application/json",
      bucket,
    );
  }

  async deleteKey(key: string, bucket?: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket ?? this.defaultBucket, Key: key }));
  }

  async getEventIndex(eventSlug: string): Promise<EventIndex | null> {
    return this.getJSON<EventIndex>(`images/${eventSlug}/index.json`);
  }

  async updateEventIndex(eventSlug: string, image: ImageMetadata): Promise<void> {
    const existing = (await this.getEventIndex(eventSlug)) ?? {
      eventSlug,
      lastUpdated: new Date().toISOString(),
      images: [],
    };

    existing.images.push(image);
    existing.lastUpdated = new Date().toISOString();
    await this.putJSON(`images/${eventSlug}/index.json`, existing);

    log.info("r2", `Updated index for ${eventSlug}: ${existing.images.length} images`);
  }

  async removeImagesForMessage(eventSlug: string, discordMessageId: string): Promise<number> {
    const index = await this.getEventIndex(eventSlug);
    if (!index) return 0;

    const toRemove = index.images.filter((img) => img.discordMessageId === discordMessageId);
    if (toRemove.length === 0) return 0;

    for (const img of toRemove) {
      await this.deleteKey(`images/${eventSlug}/${img.filename}`);
    }

    index.images = index.images.filter((img) => img.discordMessageId !== discordMessageId);
    index.lastUpdated = new Date().toISOString();
    await this.putJSON(`images/${eventSlug}/index.json`, index);

    return toRemove.length;
  }
}
