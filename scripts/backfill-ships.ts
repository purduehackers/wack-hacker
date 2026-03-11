/**
 * Backfill ships from Discord's #ships channel into the Turso database.
 *
 * Usage:
 *   bun run scripts/backfill-ships.ts [--after YYYY-MM-DD]
 *
 * Reads config from .env.local. Uses the same env vars as the bot:
 *   DISCORD_BOT_TOKEN, SHIP_DATABASE_URL, SHIP_DATABASE_AUTH_TOKEN,
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, SHIP_R2_BUCKET_NAME
 *
 * Deduplicates by message_id — skips any message already in the database.
 */

import { Client, GatewayIntentBits, SnowflakeUtil, type Message } from "discord.js";
import { createClient } from "@libsql/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const SHIP_CHANNEL_ID = "904896819165814794";
const URL_PATTERN = /https?:\/\/\S+/i;

// --- Parse args ---
const afterFlag = process.argv.indexOf("--after");
const afterDate = afterFlag !== -1 ? new Date(process.argv[afterFlag + 1]) : null;

if (afterDate && isNaN(afterDate.getTime())) {
    console.error("Invalid --after date. Use YYYY-MM-DD format.");
    process.exit(1);
}

// --- Env ---
const {
    DISCORD_BOT_TOKEN,
    SHIP_DATABASE_URL,
    SHIP_DATABASE_AUTH_TOKEN,
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    SHIP_R2_BUCKET_NAME,
} = process.env;

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!SHIP_DATABASE_URL) throw new Error("SHIP_DATABASE_URL is required");
if (!R2_ACCOUNT_ID) throw new Error("R2_ACCOUNT_ID is required");
if (!R2_ACCESS_KEY_ID) throw new Error("R2_ACCESS_KEY_ID is required");
if (!R2_SECRET_ACCESS_KEY) throw new Error("R2_SECRET_ACCESS_KEY is required");
if (!SHIP_R2_BUCKET_NAME) throw new Error("SHIP_R2_BUCKET_NAME is required");

// --- Clients ---
const db = createClient({ url: SHIP_DATABASE_URL, authToken: SHIP_DATABASE_AUTH_TOKEN });

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// --- Helpers ---
async function getExistingMessageIds(): Promise<Set<string>> {
    const result = await db.execute("SELECT message_id FROM ship WHERE message_id IS NOT NULL");
    return new Set(result.rows.map((r) => r.message_id as string));
}

function isValidShip(message: Message): boolean {
    if (message.author.bot) return false;

    const hasUrl = URL_PATTERN.test(message.content);
    const hasAttachment = message.attachments.size > 0;

    if (!hasUrl && !hasAttachment) {
        for (const [, snapshot] of message.messageSnapshots) {
            if (snapshot.content && URL_PATTERN.test(snapshot.content)) return true;
            if (snapshot.attachments.size > 0) return true;
        }
        return false;
    }

    return true;
}

async function uploadAttachment(
    buffer: Buffer,
    messageId: string,
    filename: string,
    contentType: string,
): Promise<string> {
    const isImage = contentType.startsWith("image/");
    const body = isImage ? await sharp(buffer).jpeg().toBuffer() : buffer;
    const key = `images/ships/${messageId}-${filename}`;

    await s3.send(
        new PutObjectCommand({
            Bucket: SHIP_R2_BUCKET_NAME,
            Key: key,
            Body: body,
            ContentType: isImage ? "image/jpeg" : contentType,
        }),
    );

    return key;
}

async function downloadAttachment(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
}

async function processMessage(message: Message): Promise<void> {
    let content = message.content;
    const allAttachments = [...message.attachments.values()];

    for (const [, snapshot] of message.messageSnapshots) {
        if (snapshot.content) {
            content = content ? `${content}\n${snapshot.content}` : snapshot.content;
        }
        for (const [, attachment] of snapshot.attachments) {
            allAttachments.push(attachment);
        }
    }

    const uploadedAttachments: Array<{ key: string; type: string; filename: string; width?: number; height?: number }> = [];

    for (const attachment of allAttachments) {
        const ct = attachment.contentType ?? "";
        const isMedia = ct.startsWith("image/") || ct.startsWith("video/");
        if (!isMedia) continue;

        try {
            const buffer = await downloadAttachment(attachment.url);
            const fname = attachment.name ?? (ct.startsWith("video/") ? "video.mp4" : "image.jpg");
            const key = await uploadAttachment(buffer, message.id, fname, ct);
            uploadedAttachments.push({ key, type: ct, filename: fname, width: attachment.width ?? undefined, height: attachment.height ?? undefined });
        } catch (e) {
            console.warn(`  Failed to upload attachment ${attachment.name}: ${e}`);
        }
    }

    const avatarUrl = message.author.displayAvatarURL({ size: 128, extension: "png" });
    const username =
        message.member?.displayName ?? message.author.displayName ?? message.author.username;
    const shippedAt = message.createdAt.toISOString();
    const id = crypto.randomUUID();

    await db.execute({
        sql: `INSERT INTO ship (id, user_id, username, avatar_url, message_id, title, content, attachments, shipped_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            id,
            message.author.id,
            username,
            avatarUrl,
            message.id,
            null,
            content,
            JSON.stringify(uploadedAttachments),
            shippedAt,
        ],
    });
}

// --- Main ---
async function main() {
    console.log("Logging in to Discord...");
    await discord.login(DISCORD_BOT_TOKEN);
    console.log(`Logged in as ${discord.user?.tag}`);

    const channel = await discord.channels.fetch(SHIP_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
        throw new Error("Could not find #ships channel");
    }

    console.log("Fetching existing message IDs for deduplication...");
    const existing = await getExistingMessageIds();
    console.log(`Found ${existing.size} existing ships in database`);

    let totalFetched = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalInvalid = 0;

    let afterSnowflake: string | undefined;
    if (afterDate) {
        afterSnowflake = SnowflakeUtil.generate({ timestamp: afterDate.getTime() }).toString();
        console.log(`Fetching messages after ${afterDate.toISOString()}`);
    }

    let lastId = afterSnowflake;

    while (true) {
        const options: { limit: number; after?: string } = { limit: 100 };
        if (lastId) options.after = lastId;

        const messages = await channel.messages.fetch(options);
        if (messages.size === 0) break;

        totalFetched += messages.size;

        const sorted = [...messages.values()].sort(
            (a, b) => a.createdTimestamp - b.createdTimestamp,
        );

        for (const message of sorted) {
            if (existing.has(message.id)) {
                totalSkipped++;
                continue;
            }

            if (!isValidShip(message)) {
                totalInvalid++;
                continue;
            }

            try {
                await processMessage(message);
                totalInserted++;
                const date = message.createdAt.toISOString().slice(0, 10);
                console.log(
                    `  [${totalInserted}] ${message.author.username} - ${date} - ${message.id}`,
                );
            } catch (e) {
                console.error(`  Failed to process ${message.id}: ${e}`);
            }
        }

        lastId = sorted[sorted.length - 1].id;

        console.log(
            `Fetched ${totalFetched} messages, inserted ${totalInserted}, skipped ${totalSkipped} dupes, ${totalInvalid} invalid`,
        );

        await new Promise((r) => setTimeout(r, 1000));
    }

    console.log("\nBackfill complete!");
    console.log(`  Total fetched: ${totalFetched}`);
    console.log(`  Inserted: ${totalInserted}`);
    console.log(`  Skipped (dupes): ${totalSkipped}`);
    console.log(`  Invalid (no url/attachment): ${totalInvalid}`);

    discord.destroy();
    process.exit(0);
}

main().catch((e) => {
    console.error("Fatal error:", e);
    discord.destroy();
    process.exit(1);
});
