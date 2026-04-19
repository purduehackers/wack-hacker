import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: ["./src/lib/shopping/schemas/*.ts", "./src/lib/shopping/relations.ts"],
  out: "./drizzle/shopping",
  dbCredentials: {
    url: process.env.SHOPPING_DATABASE_TURSO_DATABASE_URL ?? "",
    authToken: process.env.SHOPPING_DATABASE_TURSO_AUTH_TOKEN,
  },
});
