import { Redis } from "@upstash/redis";

import type { Cart } from "./types.ts";

const CART_KEY = "shopping:cart:global";
const CART_TTL_SECONDS = 60 * 60 * 24 * 30;

let redis: Redis;
function getRedis() {
  return (redis ??= Redis.fromEnv());
}

export async function getCart(): Promise<Cart> {
  const cart = await getRedis().get<Cart>(CART_KEY);
  return cart ?? { items: [], updatedAt: new Date().toISOString() };
}

export async function saveCart(cart: Cart): Promise<void> {
  await getRedis().set(
    CART_KEY,
    { ...cart, updatedAt: new Date().toISOString() },
    { ex: CART_TTL_SECONDS },
  );
}

export async function clearCart(): Promise<void> {
  await getRedis().del(CART_KEY);
}
