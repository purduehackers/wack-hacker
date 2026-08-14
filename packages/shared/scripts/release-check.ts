#!/usr/bin/env bun

import {
  InvalidInput,
  InvariantViolated,
  messageOf,
  NotFound,
  serializeError,
  Transient,
  UpstreamError,
} from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { Redis } from "@upstash/redis";
import { z } from "zod";

import { readActiveBotGeneration } from "../src/bot/generation.ts";
import { readyHealthReportSchema } from "../src/bot/health.ts";
import type { RedisEnv } from "../src/env/scripts.ts";
import { redisEnv } from "../src/env/scripts.ts";
import { vcrDigestImage } from "../src/formats.ts";

function usage(): never {
  console.error(`usage:
  bun packages/shared/scripts/release-check.ts image <vcr-image@sha256:digest>
  bun packages/shared/scripts/release-check.ts smoke <vcr-image@sha256:digest>
  bun packages/shared/scripts/release-check.ts active`);
  process.exit(2);
}

function requireImage(value: string | undefined): Result<string, InvalidInput> {
  const parsed = vcrDigestImage.safeParse(value);
  if (!parsed.success) {
    return Result.err(
      new InvalidInput({
        subject: "release image",
        issues: [
          "image must be a lowercase vcr.vercel.com repository followed by @sha256:<64 lowercase hex>",
        ],
      }),
    );
  }
  return Result.ok(parsed.data);
}

/** The validated Upstash credentials, or the reason the environment is unusable. */
function requireRedisEnv(): Result<RedisEnv, InvalidInput> {
  return Result.try({
    try: () => redisEnv(),
    catch: (cause) =>
      new InvalidInput({ subject: "Upstash Redis environment", issues: [messageOf(cause)] }),
  });
}

async function checkImage(image: string): Promise<Result<void, InvalidInput | UpstreamError>> {
  return Result.gen(async function* () {
    const [status, stdout, stderr] = yield* Result.await(
      Result.tryPromise({
        try: () => {
          const inspect = Bun.spawn(["docker", "buildx", "imagetools", "inspect", image], {
            stdout: "pipe",
            stderr: "pipe",
          });
          return Promise.all([
            inspect.exited,
            new Response(inspect.stdout).text(),
            new Response(inspect.stderr).text(),
          ]);
        },
        catch: (cause) =>
          new UpstreamError({ service: "docker", status: 0, detail: messageOf(cause) }),
      }),
    );
    if (status !== 0) {
      return Result.err(
        new UpstreamError({
          service: "VCR",
          status: 0,
          detail: `did not serve the exact digest: ${stderr.trim() || `exit ${status}`}`,
        }),
      );
    }
    if (!/^Digest:\s+sha256:[a-f0-9]{64}$/mu.test(stdout)) {
      return Result.err(
        new InvalidInput({
          subject: "release image",
          issues: ["registry inspection did not report an immutable digest"],
        }),
      );
    }
    if (!/^\s*Platform:\s+linux\/amd64\s*$/mu.test(stdout)) {
      return Result.err(
        new InvalidInput({
          subject: "release image",
          issues: ["image index does not contain linux/amd64"],
        }),
      );
    }
    console.info(JSON.stringify({ ok: true, check: "vcr-image", image }));
    return Result.ok(undefined);
  });
}

async function smoke(
  expectedImage: string,
): Promise<Result<void, InvalidInput | InvariantViolated | NotFound | Transient | UpstreamError>> {
  return Result.gen(async function* () {
    const redis = new Redis(yield* requireRedisEnv());
    const active = yield* Result.await(
      Result.tryPromise({
        try: () => readActiveBotGeneration(redis),
        catch: (cause) =>
          new Transient({ operation: "read active bot generation", detail: messageOf(cause) }),
      }),
    );
    if (active === undefined) {
      return Result.err(new NotFound({ kind: "active bot generation", id: "bot" }));
    }
    if (active.image !== expectedImage) {
      return Result.err(
        new InvariantViolated({
          invariant: "the active image is the released image",
          detail: `expected ${expectedImage}, received ${active.image}`,
        }),
      );
    }
    if (Date.parse(active.expiresAt) <= Date.now()) {
      return Result.err(
        new InvariantViolated({
          invariant: "the active generation has not expired",
          detail: `sandbox ${active.sandboxName} expired at ${active.expiresAt}`,
        }),
      );
    }

    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          fetch(active.healthUrl, {
            headers: { Accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          }),
        catch: (cause) =>
          new Transient({ operation: "fetch bot health", detail: messageOf(cause) }),
      }),
    );
    if (!response.ok) {
      return Result.err(
        new UpstreamError({
          service: "bot health",
          status: response.status,
          detail: "health endpoint returned a failure status",
        }),
      );
    }
    const payload: unknown = yield* Result.await(
      Result.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new UpstreamError({
            service: "bot health",
            status: response.status,
            detail: `body is not JSON: ${messageOf(cause)}`,
          }),
      }),
    );
    const parsedHealth = readyHealthReportSchema.safeParse(payload);
    if (!parsedHealth.success) {
      return Result.err(
        new InvalidInput({
          subject: "bot health payload",
          issues: [z.prettifyError(parsedHealth.error)],
        }),
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
    return Result.ok(undefined);
  });
}

/**
 * The digest currently serving, for a release record to name as the rollback
 * target. Prints `unknown` rather than failing when nothing is active yet. The
 * first promotion into an empty environment has no predecessor, and that is
 * not an error.
 */
async function printActiveImage(): Promise<Result<void, InvalidInput | Transient>> {
  return Result.gen(async function* () {
    const redis = new Redis(yield* requireRedisEnv());
    const active = yield* Result.await(
      Result.tryPromise({
        try: () => readActiveBotGeneration(redis),
        catch: (cause) =>
          new Transient({ operation: "read active bot generation", detail: messageOf(cause) }),
      }),
    );
    console.log(active?.image ?? "unknown");
    return Result.ok(undefined);
  });
}

const [command, imageArgument, ...extra] = process.argv.slice(2);
if (extra.length > 0 || (command !== "image" && command !== "smoke" && command !== "active")) {
  usage();
}

const outcome = await Result.gen(async function* () {
  if (command === "active") {
    if (imageArgument !== undefined) usage();
    yield* Result.await(printActiveImage());
    return Result.ok(undefined);
  }
  const image = yield* requireImage(imageArgument);
  if (command === "image") yield* Result.await(checkImage(image));
  else yield* Result.await(smoke(image));
  return Result.ok(undefined);
});

outcome.match({
  ok: () => {},
  err: (error) => {
    console.error(JSON.stringify(serializeError(error)));
    process.exit(1);
  },
});
