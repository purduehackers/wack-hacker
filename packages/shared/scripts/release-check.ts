#!/usr/bin/env bun

import { Redis } from "@upstash/redis";

const IMAGE_PATTERN = /^vcr\.vercel\.com\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const ACTIVE_KEY = "wack:bot-sandbox:active:v1";

interface ActiveGeneration {
  readonly version: 1;
  readonly generation: number;
  readonly sandboxName: string;
  readonly image: string;
  readonly healthUrl: string;
  readonly expiresAt: string;
}

function usage(): never {
  console.error(`usage:
  bun packages/shared/scripts/release-check.ts image <vcr-image@sha256:digest>
  bun packages/shared/scripts/release-check.ts smoke <vcr-image@sha256:digest>`);
  process.exit(2);
}

function requireImage(value: string | undefined): string {
  if (value === undefined || !IMAGE_PATTERN.test(value)) {
    throw new Error(
      "image must be a lowercase vcr.vercel.com repository followed by @sha256:<64 lowercase hex>",
    );
  }
  return value;
}

function stringField(value: object, key: string): string {
  const field = Reflect.get(value, key);
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`active generation has invalid ${key}`);
  }
  return field;
}

function activeGeneration(raw: unknown): ActiveGeneration {
  let parsed: unknown = raw;
  if (typeof raw === "string") parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("active bot generation is missing or malformed");
  }
  const version = Reflect.get(parsed, "version");
  const generation = Reflect.get(parsed, "generation");
  if (version !== 1 || !Number.isSafeInteger(generation) || Number(generation) < 1) {
    throw new Error("active bot generation has an invalid fence");
  }
  return {
    version,
    generation: Number(generation),
    sandboxName: stringField(parsed, "sandboxName"),
    image: stringField(parsed, "image"),
    healthUrl: stringField(parsed, "healthUrl"),
    expiresAt: stringField(parsed, "expiresAt"),
  };
}

function validHealth(value: unknown): value is {
  readonly ready: true;
  readonly websocketPingMs: number;
  readonly uptimeSeconds: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const ready = Reflect.get(value, "ready");
  const ping = Reflect.get(value, "websocketPingMs");
  const uptime = Reflect.get(value, "uptimeSeconds");
  return (
    typeof ready === "boolean" &&
    ready &&
    Number.isInteger(ping) &&
    Number(ping) >= -1 &&
    Number.isSafeInteger(uptime) &&
    Number(uptime) >= 0
  );
}

async function checkImage(image: string): Promise<void> {
  const process = Bun.spawn(["docker", "buildx", "imagetools", "inspect", image], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (status !== 0) {
    throw new Error(`VCR did not serve the exact digest: ${stderr.trim() || `exit ${status}`}`);
  }
  if (!/^Digest:\s+sha256:[a-f0-9]{64}$/mu.test(stdout)) {
    throw new Error("registry inspection did not report an immutable digest");
  }
  if (!/^\s*Platform:\s+linux\/amd64\s*$/mu.test(stdout)) {
    throw new Error("image index does not contain linux/amd64");
  }
  console.info(JSON.stringify({ ok: true, check: "vcr-image", image }));
}

async function smoke(expectedImage: string): Promise<void> {
  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL and token are required");

  const redis = new Redis({ url, token });
  const active = activeGeneration(await redis.get(ACTIVE_KEY));
  if (active.image !== expectedImage) {
    throw new Error(`active image mismatch: expected ${expectedImage}, received ${active.image}`);
  }
  if (Date.parse(active.expiresAt) <= Date.now()) {
    throw new Error(`active sandbox ${active.sandboxName} is already expired`);
  }

  const response = await fetch(active.healthUrl, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`bot health returned ${response.status}`);
  const body: unknown = await response.json();
  if (!validHealth(body)) throw new Error("bot health payload is invalid or not ready");
  console.info(
    JSON.stringify({
      ok: true,
      check: "production-smoke",
      generation: active.generation,
      sandboxName: active.sandboxName,
      image: active.image,
      websocketPingMs: body.websocketPingMs,
      uptimeSeconds: body.uptimeSeconds,
    }),
  );
}

const [command, imageArgument, ...extra] = process.argv.slice(2);
if (extra.length > 0 || (command !== "image" && command !== "smoke")) usage();
const image = requireImage(imageArgument);
if (command === "image") await checkImage(image);
else await smoke(image);
