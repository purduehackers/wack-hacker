import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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

  async deleteKey(key: string, bucket?: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket ?? this.defaultBucket, Key: key }));
  }
}
