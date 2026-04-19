import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "../../env.ts";
import * as relations from "./relations.ts";
import * as schemas from "./schemas/index.ts";

const schema = { ...schemas, ...relations };

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: Db | undefined;

export function buildDb(client: Client): Db {
  return drizzle(client, { schema });
}

export function getDb(): Db {
  if (!cachedDb) {
    const url = env.SHOPPING_DATABASE_TURSO_DATABASE_URL;
    if (!url) {
      throw new Error(
        "Shopping cart database is not configured — set SHOPPING_DATABASE_TURSO_DATABASE_URL",
      );
    }
    const client = createClient({ url, authToken: env.SHOPPING_DATABASE_TURSO_AUTH_TOKEN });
    cachedDb = buildDb(client);
  }
  return cachedDb;
}
