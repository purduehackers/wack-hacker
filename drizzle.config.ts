import { defineConfig } from "drizzle-kit";

const accountId = process.env.D1_ACCOUNT_ID;
const databaseId = process.env.D1_DATABASE_ID;
const token = process.env.D1_API_TOKEN;

if (!accountId || !databaseId || !token) {
    throw new Error("Missing D1 credentials");
}

export default defineConfig({
    dialect: "sqlite",
    schema: "./src/db/schema.ts",
  out: "./migrations",
  driver: "d1-http",
  dbCredentials: {
      accountId,
      databaseId,
      token,
    },
});
