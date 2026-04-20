import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "../../env.ts";
import * as hackNightImages from "./schemas/hack-night-images.ts";
import * as relations from "./schemas/relations.ts";
import * as shoppingCartItems from "./schemas/shopping-cart-items.ts";
import * as shoppingCarts from "./schemas/shopping-carts.ts";

const schema = { ...shoppingCarts, ...shoppingCartItems, ...hackNightImages, ...relations };

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: Db | undefined;

export function buildDb(client: Client): Db {
  return drizzle(client, { schema });
}

export function getDb(): Db {
  if (!cachedDb) {
    const client = createClient({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    cachedDb = buildDb(client);
  }
  return cachedDb;
}
