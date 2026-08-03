/**
 * Turso (libSQL) access.
 *
 * The legacy version read `env` directly at module scope, which coupled the data
 * layer to one env schema. Here the config is passed in: each package resolves
 * its own env and calls `getDb` once.
 *
 * The connection is memoized because a libSQL client holds an HTTP agent, and
 * rebuilding it per query would leak sockets in a long-running process.
 */

import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as actionAudit from "./schemas/action-audit.ts";
import * as relations from "./schemas/relations.ts";
import * as scheduledTasks from "./schemas/scheduled-tasks.ts";
import * as shoppingCartItems from "./schemas/shopping-cart-items.ts";
import * as shoppingCarts from "./schemas/shopping-carts.ts";

export * from "./enums.ts";
export type { TaskAction } from "./types.ts";
export { actionAudit } from "./schemas/action-audit.ts";
export { scheduledTasks } from "./schemas/scheduled-tasks.ts";
export { shoppingCartItems } from "./schemas/shopping-cart-items.ts";
export { shoppingCarts } from "./schemas/shopping-carts.ts";

const schema = {
  ...shoppingCarts,
  ...shoppingCartItems,
  ...scheduledTasks,
  ...actionAudit,
  ...relations,
};

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface TursoConfig {
  readonly url: string;
  readonly authToken?: string;
}

/** Wraps a caller-supplied client, for example a local `file:` database. */
export function buildDb(client: Client): Db {
  return drizzle(client, { schema });
}

let cached: Db | undefined;

/**
 * Process-wide database handle. The first call decides the config; later calls
 * ignore theirs and return the same handle, which is what makes it safe to call
 * from anywhere without threading a singleton around.
 */
export function getDb(config: TursoConfig): Db {
  cached ??= buildDb(
    createClient(
      config.authToken === undefined
        ? { url: config.url }
        : { url: config.url, authToken: config.authToken },
    ),
  );
  return cached;
}
