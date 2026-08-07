import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs as a CLI outside the application, so it reads `process.env`
 * directly rather than going through a package env schema. Throwing here is
 * correct: a migration against an unset database must fail loudly before it can
 * touch anything.
 *
 * The first three migrations describe the carried-over production tables. The
 * gold architecture adds one data-preserving scheduled-task migration after
 * that baseline. Generating a migration that recreates unrelated tables would
 * mean the schema drifted — treat that as a bug, not a fresh baseline.
 */
const url = process.env["TURSO_DATABASE_URL"];
if (url === undefined || url === "") {
  throw new Error("Missing required environment variable: TURSO_DATABASE_URL");
}

const authToken = process.env["TURSO_AUTH_TOKEN"];

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schemas/*.ts",
  out: "./drizzle",
  dbCredentials: authToken === undefined ? { url } : { url, authToken },
});
