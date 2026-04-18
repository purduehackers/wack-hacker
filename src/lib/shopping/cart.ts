import { Redis } from "@upstash/redis";

import type { Cart } from "./types.ts";

const CART_KEY = "shopping:cart:global";
const CART_TTL_SECONDS = 60 * 60 * 24 * 30;
const LOCK_KEY = "shopping:cart:lock";
const LOCK_TTL_MS = 5000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_ATTEMPTS = 40;

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

let redis: Redis;
function getRedis() {
  return (redis ??= Redis.fromEnv());
}

export async function getCart(): Promise<Cart> {
  const cart = await getRedis().get<Cart>(CART_KEY);
  return cart ?? { items: [], updatedAt: new Date().toISOString() };
}

async function acquireLock(): Promise<string> {
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    const result = await getRedis().set(LOCK_KEY, token, { nx: true, px: LOCK_TTL_MS });
    if (result !== null) return token;
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
  throw new Error("Timed out waiting for shopping cart lock");
}

async function releaseLock(token: string): Promise<void> {
  await getRedis().eval(RELEASE_LOCK_SCRIPT, [LOCK_KEY], [token]);
}

/**
 * Read-modify-write the cart under a Redis lock. Serializes mutations so
 * concurrent tool calls from different organizers can't overwrite each other.
 */
export async function updateCart<T>(mutate: (cart: Cart) => T | Promise<T>): Promise<T> {
  const token = await acquireLock();
  try {
    const cart = await getCart();
    const result = await mutate(cart);
    await getRedis().set(
      CART_KEY,
      { ...cart, updatedAt: new Date().toISOString() },
      { ex: CART_TTL_SECONDS },
    );
    return result;
  } finally {
    await releaseLock(token);
  }
}

export async function clearCart(): Promise<void> {
  const token = await acquireLock();
  try {
    await getRedis().del(CART_KEY);
  } finally {
    await releaseLock(token);
  }
}
