/**
 * Native Redis access shared by the Node.js agent and Bun bot.
 *
 * Keep existing keys and JSON wire values so data copied from Upstash remains
 * readable. Preserve automatic JSON decoding for readers that expect objects.
 * Lua commands retain their atomicity and receive the original keys and argv.
 */

import { createClient } from "redis";
import { z } from "zod";

import { jsonCodec } from "../json.ts";

interface RedisConfig {
  readonly url: string;
}

interface SetOptions {
  readonly nx?: boolean;
  readonly keepTtl?: boolean;
  readonly ex?: number;
  readonly px?: number;
}

/** Strings are already wire values; objects use the former JSON encoding. */
function serialize(value: unknown): string {
  const text = z.string().safeParse(value);
  if (text.success) return text.data;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Redis values must be JSON serializable");
  return encoded;
}

const jsonValue = jsonCodec(z.unknown());

/** Match the former client's JSON results without rounding numeric identifiers. */
function deserialize(value: unknown): unknown {
  const elements = z.array(z.unknown()).safeParse(value);
  if (elements.success) return elements.data.map(deserialize);
  const text = z.string().safeParse(value);
  if (!text.success) return value;
  const decoded = jsonValue.safeParse(text.data);
  if (!decoded.success) return text.data;
  const numeric = z.number().safeParse(decoded.data);
  if (numeric.success && String(numeric.data) !== text.data) return text.data;
  return decoded.data;
}

function createRedis(config: RedisConfig) {
  const client = createClient({
    url: config.url,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
    disableOfflineQueue: true,
  });
  client.on("error", () => console.error("Redis connection failed"));
  let connecting: Promise<unknown> | undefined;

  /** Share concurrent connection attempts; a later command can retry a failed connection. */
  async function ready() {
    if (!client.isOpen) {
      connecting ??= client.connect().finally(() => {
        connecting = undefined;
      });
    }
    await connecting;
    return client.withCommandOptions({ timeout: 5000 });
  }

  return {
    async get(key: string) {
      return deserialize(await (await ready()).get(key));
    },
    async set(key: string, value: unknown, options: SetOptions = {}) {
      return (await ready()).set(key, serialize(value), {
        ...(options.nx ? { NX: true } : {}),
        ...(options.keepTtl ? { KEEPTTL: true } : {}),
        ...(options.ex === undefined ? {} : { EX: options.ex }),
        ...(options.px === undefined ? {} : { PX: options.px }),
      });
    },
    async del(...keys: string[]) {
      return (await ready()).del(keys);
    },
    async expire(key: string, seconds: number) {
      return (await ready()).expire(key, seconds);
    },
    async eval(script: string, scriptKeys: string[], argv: (string | number)[]) {
      return deserialize(
        await (await ready()).eval(script, { keys: scriptKeys, arguments: argv.map(String) }),
      );
    },
    async incrby(key: string, increment: number) {
      return (await ready()).incrBy(key, increment);
    },
    async sadd(key: string, ...members: string[]) {
      return (await ready()).sAdd(key, members);
    },
    async smembers(key: string) {
      return (await ready()).sMembers(key);
    },
    async srem(key: string, ...members: string[]) {
      return (await ready()).sRem(key, members);
    },
    async scard(key: string) {
      return (await ready()).sCard(key);
    },
    async sismember(key: string, member: string) {
      return Number(await (await ready()).sIsMember(key, member));
    },
    async exists(...keys: string[]) {
      return (await ready()).exists(keys);
    },
    async pttl(key: string) {
      return (await ready()).pTTL(key);
    },
    async llen(key: string) {
      return (await ready()).lLen(key);
    },
    async close() {
      if (client.isOpen) await client.close();
    },
  };
}

export type RedisClient = Omit<ReturnType<typeof createRedis>, "close">;

let cached: ReturnType<typeof createRedis> | undefined;

/** One lazy TCP/TLS connection per process, using the same URL in bot and agent. */
export function getRedis(config: RedisConfig): RedisClient {
  cached ??= createRedis(config);
  return cached;
}

/** Release the socket after a one-shot operational script. */
export async function closeRedis(): Promise<void> {
  await cached?.close();
  cached = undefined;
}
