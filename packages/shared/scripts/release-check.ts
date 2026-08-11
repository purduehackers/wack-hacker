#!/usr/bin/env bun

import { Redis } from "@upstash/redis";
import { z } from "zod";

import { readActiveBotGeneration } from "../src/bot/generation.ts";
import { readyHealthReportSchema } from "../src/bot/health.ts";
import { redisEnv } from "../src/env/scripts.ts";
import { vcrDigestImage } from "../src/formats.ts";

function usage(): never {
  console.error(`usage:
  bun packages/shared/scripts/release-check.ts image <vcr-image@sha256:digest>
  bun packages/shared/scripts/release-check.ts smoke <vcr-image@sha256:digest>
  bun packages/shared/scripts/release-check.ts active`);
  process.exit(2);
}

function requireImage(value: string | undefined): string {
  const parsed = vcrDigestImage.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "image must be a lowercase vcr.vercel.com repository followed by @sha256:<64 lowercase hex>",
    );
  }
  return parsed.data;
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
  const redis = new Redis(redisEnv());
  const active = await readActiveBotGeneration(redis);
  if (active === undefined) throw new Error("active bot generation is missing");
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
  const parsedHealth = readyHealthReportSchema.safeParse(await response.json());
  if (!parsedHealth.success) {
    throw new Error(
      `bot health payload is invalid or not ready:\n${z.prettifyError(parsedHealth.error)}`,
    );
  }
  const health = parsedHealth.data;
  console.info(
    JSON.stringify({
      ok: true,
      check: "production-smoke",
      generation: active.generation,
      sandboxName: active.sandboxName,
      image: active.image,
      websocketPingMs: health.websocketPingMs,
      uptimeSeconds: health.uptimeSeconds,
    }),
  );
}

/**
 * The digest currently serving, for a release record to name as the rollback
 * target. Prints `unknown` rather than failing when nothing is active yet — the
 * first promotion into an empty environment has no predecessor, and that is not
 * an error.
 */
async function printActiveImage(): Promise<void> {
  const active = await readActiveBotGeneration(new Redis(redisEnv()));
  console.log(active?.image ?? "unknown");
}

const [command, imageArgument, ...extra] = process.argv.slice(2);
if (extra.length > 0 || (command !== "image" && command !== "smoke" && command !== "active")) {
  usage();
}
if (command === "active") {
  if (imageArgument !== undefined) usage();
  await printActiveImage();
} else {
  const image = requireImage(imageArgument);
  if (command === "image") await checkImage(image);
  else await smoke(image);
}
