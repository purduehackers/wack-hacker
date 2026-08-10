import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs as a CLI outside the application, so it reads `process.env`
 * directly rather than going through a package env schema. Throwing here is
 * correct: a migration against an unset database must fail loudly before it can
 * touch anything.
 *
 * `migrations/` starts from a single generated baseline. There is no prior
 * production database to preserve, so a migration that recreates unrelated
 * tables means the schema drifted — treat that as a bug, not a new baseline.
 */
const url = process.env["TURSO_DATABASE_URL"];
if (url === undefined || url === "") {
  throw new Error("Missing required environment variable: TURSO_DATABASE_URL");
}

const authToken = process.env["TURSO_AUTH_TOKEN"];

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schemas/*.ts",
  out: "./migrations",
  dbCredentials: authToken === undefined ? { url } : { url, authToken },
});
