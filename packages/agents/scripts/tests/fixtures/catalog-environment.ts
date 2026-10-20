// Supply explicit local settings so the normal environment parser is exercised.
// Imported runtime modules share the process Redis singleton with integration
// tests. Always use their explicit test URL when present, regardless of which
// suite initializes it first; never inherit an application's live Redis URL.
process.env["AGENT_INGRESS_SECRET"] ??= "catalog-test";
process.env["BOT_INGRESS_SECRET"] ??= "catalog-test";
process.env["BOT_URL"] ??= "http://127.0.0.1:1";
process.env["REDIS_URL"] = process.env["REDIS_TEST_URL"] ?? "redis://127.0.0.1:1";
process.env["TURSO_DATABASE_URL"] ??= "file::memory:";
process.env["MAIN_AGENT_CATALOG_ENABLED"] = "true";
