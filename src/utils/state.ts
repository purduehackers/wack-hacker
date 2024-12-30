import { Readable } from "node:stream";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

import { env } from "../env";

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

type Birthday = {
  userId: string;
  date: string;
};

type State = {
  birthdays?: Birthday[];
};

export async function getState(): Promise<State> {
  const { Body } = await s3.send(
    new GetObjectCommand({
      Bucket: env.BUCKET_NAME,
      Key: "state.json",
    }),
  );

  if (!Body || !(Body instanceof Readable)) {
    throw new Error("Invalid body");
  }

  const body = await streamToString(Body);

  return JSON.parse(body);
}

export async function setState(state: State): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.BUCKET_NAME,
      Key: "state.json",
      Body: JSON.stringify(state),
      ContentType: "application/json",
    }),
  );
}

const streamToString = (stream: Readable): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
