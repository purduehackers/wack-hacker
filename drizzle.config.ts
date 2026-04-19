import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.TURSO_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required environment variable: TURSO_DATABASE_URL");
}

export default defineConfig({
  dialect: "turso",
  schema: ["./src/lib/shopping/schemas/*.ts", "./src/lib/shopping/relations.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
