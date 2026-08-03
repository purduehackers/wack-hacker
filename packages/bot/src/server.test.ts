import type { Client } from "discord.js";
import { expect, test } from "vitest";

import { handleRequest, healthOf } from "./server.ts";
import { asDouble } from "./test/double.ts";

/**
 * A fake standing in for the two discord.js fields health actually reads.
 * `readyTimestamp` is `null` until the gateway connects — that is the contract
 * being modelled, and the reason `null` appears at all in this package.
 */
function fakeClient(readyTimestamp: number | null, ping: number): Client {
  return asDouble<Client>({ readyTimestamp, ws: { ping } });
}

test("readiness means the gateway is connected, not that the process is alive", () => {
  const connecting = healthOf(fakeClient(JSON.parse("null"), -1));

  expect(connecting.ready).toBe(false);
  expect(connecting.uptimeSeconds).toBe(0);
});

test("a connected gateway reports ready with its ping", () => {
  const report = healthOf(fakeClient(1_000, 42.6), () => 61_000);

  expect(report.ready).toBe(true);
  expect(report.websocketPingMs).toBe(43);
  expect(report.uptimeSeconds).toBe(60);
});

test("uptime is measured from ready, not from process start", () => {
  // A reconnect resets readyTimestamp, and that is what we want to surface: a
  // freshly resumed socket is young even inside an old process.
  const report = healthOf(fakeClient(10_000, 10), () => 12_500);

  expect(report.uptimeSeconds).toBe(2);
});

test("ping is rounded so the payload stays stable across heartbeats", () => {
  expect(healthOf(fakeClient(1, 0.4)).websocketPingMs).toBe(0);
  expect(healthOf(fakeClient(1, 99.5)).websocketPingMs).toBe(100);
});

test("a connecting gateway answers 503 so a probe treats the bot as failing", async () => {
  const response = handleRequest(
    new Request("http://127.0.0.1/health"),
    fakeClient(JSON.parse("null"), -1),
  );

  // 200 with ready:false would leave a wedged bot running forever, because most
  // probes only look at the status code.
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ready: false });
});

test("a connected gateway answers 200 with its report", async () => {
  const response = handleRequest(new Request("http://127.0.0.1/health"), fakeClient(1_000, 12));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ready: true, websocketPingMs: 12 });
});

test("anything else is a 404, so the bot exposes no accidental surface", () => {
  const client = fakeClient(1_000, 12);

  expect(handleRequest(new Request("http://127.0.0.1/"), client).status).toBe(404);
  // Reserved by the wire contract but not implemented until the seam lands.
  expect(handleRequest(new Request("http://127.0.0.1/internal/agent/parked"), client).status).toBe(
    404,
  );
});
