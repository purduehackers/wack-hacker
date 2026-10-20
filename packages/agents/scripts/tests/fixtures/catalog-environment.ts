// These tests perform no provider, model, Redis, database, or sandbox I/O.
// Supply explicit local settings so the normal environment parser is exercised.
process.env["AGENT_INGRESS_SECRET"] ??= "catalog-test";
process.env["BOT_INGRESS_SECRET"] ??= "catalog-test";
process.env["BOT_URL"] ??= "http://127.0.0.1:1";
process.env["REDIS_URL"] ??= "redis://127.0.0.1:1";
process.env["TURSO_DATABASE_URL"] ??= "file::memory:";
process.env["MAIN_AGENT_CATALOG_ENABLED"] = "true";
