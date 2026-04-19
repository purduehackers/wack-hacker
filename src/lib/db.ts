import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "../env.ts";
import * as shoppingRelations from "./shopping/relations.ts";
import * as shoppingSchemas from "./shopping/schemas/index.ts";

const schema = { ...shoppingSchemas, ...shoppingRelations };

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
