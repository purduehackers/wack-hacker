/**
 * Fenced Vercel Sandbox supervisor for the long-running Discord bot.
 *
 * Redis is the authority for both mutual exclusion and the active generation.
 * A sandbox is never made active until its structured `/health` response says
 * that the Discord gateway is ready. The bot token and the rest of the bot's
 * already-validated environment are explicit dependencies; this module never
 * reads an agent or bot environment singleton.
 */

import {
  BOT_ACTIVE_GENERATION_KEY,
  BOT_SUPERVISOR_FENCE_KEY,
  BOT_SUPERVISOR_MUTEX_KEY,
  decodeActiveBotGeneration,
  type ActiveBotGeneration,
} from "@repo/shared/bot/generation";
import { readyHealthReportSchema } from "@repo/shared/bot/health";
import type { RedisClient } from "@repo/shared/redis";
import { Result, TaggedError } from "@repo/shared/result";
import { APIError, Sandbox } from "@vercel/sandbox";
import { z } from "zod";

import { storedInt, storedJson } from "../core/schema.ts";

/** The port the bot process listens on inside its sandbox. */
export const BOT_PORT_DEFAULT = 8080;
const BOT_SANDBOX_TIMEOUT_MS = 24 * 60 * 60_000;
const BOT_SANDBOX_REFRESH_WINDOW_MS = 30 * 60_000;

const HEALTH_PATH = "/health";
const HEALTH_READY_TIMEOUT_MS = 2 * 60_000;
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const HEALTH_POLL_INTERVAL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 20_000;
const MUTEX_TTL_MS = 10 * 60_000;

const MANAGED_TAGS = Object.freeze({
  managedBy: "wack-hacker",
  workload: "discord-bot",
});

const ACQUIRE_MUTEX_SCRIPT = `
-- wack:bot-sandbox:acquire
if redis.call("EXISTS", KEYS[1]) == 1 then return false end
local generation = redis.call("INCR", KEYS[2])
local lease = ARGV[1] .. ":" .. tostring(generation)
redis.call("SET", KEYS[1], lease, "PX", tonumber(ARGV[2]))
return cjson.encode({ lease = lease, generation = generation })
`;

const RENEW_MUTEX_SCRIPT = `
-- wack:bot-sandbox:renew
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
return 1
`;

const RELEASE_MUTEX_SCRIPT = `
-- wack:bot-sandbox:release
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

const COMMIT_GENERATION_SCRIPT = `
-- wack:bot-sandbox:commit
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return -1 end
local current = redis.call("GET", KEYS[2])
if ARGV[2] == "" then
  if current then return 0 end
else
  if not current then return 0 end
  local decoded = cjson.decode(current)
  if tostring(decoded.generation) ~= ARGV[2] or decoded.sandboxName ~= ARGV[3] then
    return 0
  end
end
local next = cjson.decode(ARGV[4])
if tonumber(next.generation) ~= tonumber(ARGV[5]) then return -2 end
if current then
  local decoded = cjson.decode(current)
  if tonumber(next.generation) <= tonumber(decoded.generation) then return -2 end
end
redis.call("SET", KEYS[2], ARGV[4])
return 1
`;

type BotSandboxOperation =
  | "create-candidate"
  | "inspect-active"
  | "list-orphans"
  | "reconcile"
  | "start-bot"
  | "signal-old"
  | "stop-sandbox"
  | "delete-sandbox";

export class InvalidBotSandboxConfig extends TaggedError("InvalidBotSandboxConfig")<{
  field: "BOT_IMAGE" | "botEnv" | "credentials";
  detail: string;
  message: string;
}> {
  constructor(props: { field: "BOT_IMAGE" | "botEnv" | "credentials"; detail: string }) {
    super({ ...props, message: `invalid bot sandbox ${props.field}: ${props.detail}` });
  }
}

export class BotSupervisorBusy extends TaggedError("BotSupervisorBusy")<{
  message: string;
}> {
  constructor() {
    super({ message: "another bot sandbox supervisor holds the mutex" });
  }
}

export class BotSupervisorCoordinationFailed extends TaggedError(
  "BotSupervisorCoordinationFailed",
)<{
  operation: "acquire" | "read-active" | "renew" | "commit" | "release";
  detail: string;
  message: string;
}> {
  constructor(props: {
    operation: "acquire" | "read-active" | "renew" | "commit" | "release";
    detail: string;
  }) {
    super({
      ...props,
      message: `bot sandbox Redis ${props.operation} failed: ${props.detail}`,
    });
  }
}

export class InvalidBotActiveGeneration extends TaggedError("InvalidBotActiveGeneration")<{
  detail: string;
  message: string;
}> {
  constructor(detail: string) {
    super({ detail, message: `invalid active bot sandbox generation: ${detail}` });
  }
}

export class BotSupervisorFenceLost extends TaggedError("BotSupervisorFenceLost")<{
  generation: number;
  stage: string;
  message: string;
}> {
  constructor(props: { generation: number; stage: string }) {
    super({
      ...props,
      message: `bot sandbox supervisor generation ${props.generation} lost its fence at ${props.stage}`,
    });
  }
}

export class BotSandboxOperationFailed extends TaggedError("BotSandboxOperationFailed")<{
  operation: BotSandboxOperation;
  sandboxName?: string;
  detail: string;
  message: string;
}> {
  constructor(props: { operation: BotSandboxOperation; sandboxName?: string; detail: string }) {
    super({
      ...props,
      message: `bot sandbox ${props.operation} failed${
        props.sandboxName === undefined ? "" : ` for ${props.sandboxName}`
      }: ${props.detail}`,
    });
  }
}

export class BotSandboxUnhealthy extends TaggedError("BotSandboxUnhealthy")<{
  sandboxName: string;
  detail: string;
  cleanupIssues: readonly string[];
  message: string;
}> {
  constructor(props: { sandboxName: string; detail: string; cleanupIssues?: readonly string[] }) {
    const cleanupIssues = props.cleanupIssues ?? [];
    super({
      ...props,
      cleanupIssues,
      message: `bot sandbox ${props.sandboxName} did not become ready: ${props.detail}${
        cleanupIssues.length === 0 ? "" : `; cleanup: ${cleanupIssues.join("; ")}`
      }`,
    });
  }
}

export class BotSandboxCleanupFailed extends TaggedError("BotSandboxCleanupFailed")<{
  issues: readonly string[];
  message: string;
}> {
  constructor(issues: readonly string[]) {
    super({ issues, message: `bot sandbox cleanup failed: ${issues.join("; ")}` });
  }
}

export type BotSandboxSupervisorError =
  | InvalidBotSandboxConfig
  | BotSupervisorBusy
  | BotSupervisorCoordinationFailed
  | InvalidBotActiveGeneration
  | BotSupervisorFenceLost
  | BotSandboxOperationFailed
  | BotSandboxUnhealthy
  | BotSandboxCleanupFailed;

export type BotSandboxSupervisorOutcome =
  | {
      readonly status: "healthy";
      readonly active: ActiveBotGeneration;
      readonly remainingMs: number;
    }
  | {
      readonly status: "replaced";
      readonly active: ActiveBotGeneration;
      readonly previousSandboxName?: string;
    };

/**
 * SDK projections. Every parameter and member is derived from @vercel/sandbox
 * rather than restated, so an upstream signature change is a compile error here
 * instead of a runtime failure in production.
 */
type SandboxCreateParams = NonNullable<Parameters<typeof Sandbox.create>[0]>;
type SandboxGetParams = Parameters<typeof Sandbox.get>[0];
type SandboxListParams = NonNullable<Parameters<typeof Sandbox.list>[0]>;
type SdkSandbox = Awaited<ReturnType<typeof Sandbox.get>>;
type SdkSandboxPaginator = Awaited<ReturnType<typeof Sandbox.list>>;
type SdkBotCommand = Awaited<ReturnType<SdkSandbox["getCommand"]>>;

/** Explicit access-token credentials. Omit this record to use Vercel OIDC. */
export type BotSandboxCredentials = Pick<
  Extract<SandboxCreateParams, { readonly token: string }>,
  "token" | "teamId" | "projectId"
>;

/**
 * The Sandbox calls this module makes, bound to one identity.
 *
 * It exists so credentials are threaded in exactly one place rather than at
 * every call site, which is also what keeps OIDC and token auth
 * indistinguishable to the reconcile path.
 */
interface SandboxApi {
  readonly create: (input: SandboxCreateParams) => Promise<SdkSandbox>;
  readonly get: (input: SandboxGetParams) => Promise<SdkSandbox>;
  readonly list: (input: SandboxListParams) => Promise<SdkSandboxPaginator>;
}

/**
 * The Redis commands required for fencing and active-generation coordination.
 * Nothing else in the client is reachable from here, so a supervisor bug cannot
 * reach conversation or render state.
 */
type SupervisorRedis = Pick<RedisClient, "eval" | "get">;

export type BotProcessEnvironment = Readonly<Record<string, string>> & {
  readonly DISCORD_BOT_TOKEN: string;
  readonly DISCORD_BOT_CLIENT_ID: string;
  readonly AGENT_URL: string;
  readonly AGENT_INGRESS_SECRET: string;
  readonly BOT_INGRESS_SECRET: string;
  readonly UPSTASH_REDIS_REST_URL: string;
  readonly UPSTASH_REDIS_REST_TOKEN: string;
  readonly VERCEL_API_TOKEN: string;
  readonly DASHBOARD_EDGE_CONFIG: string;
  readonly PAYLOAD_CMS_API_KEY: string;
  readonly SHIP_API_KEY: string;
  readonly PHACK_API_TOKEN: string;
  readonly GROQ_API_KEY: string;
};

const REQUIRED_BOT_ENV_KEYS = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_BOT_CLIENT_ID",
  "AGENT_URL",
  "AGENT_INGRESS_SECRET",
  "BOT_INGRESS_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VERCEL_API_TOKEN",
  "DASHBOARD_EDGE_CONFIG",
  "PAYLOAD_CMS_API_KEY",
  "SHIP_API_KEY",
  "PHACK_API_TOKEN",
  "GROQ_API_KEY",
] as const satisfies readonly (keyof BotProcessEnvironment)[];

export interface BotSandboxSupervisorDeps {
  readonly redis: SupervisorRedis;
  /** Digest-pinned VCR image. Tags, including `latest`, are rejected. */
  readonly image: string;
  /** A validated bot-process record supplied by the composition root. */
  readonly botEnv: BotProcessEnvironment;
  /** Omit to authenticate with the host's Vercel OIDC identity. */
  readonly credentials?: BotSandboxCredentials;
}

export interface BotSandboxSupervisor {
  readonly ensure: () => Promise<Result<BotSandboxSupervisorOutcome, BotSandboxSupervisorError>>;
}

interface Lease {
  readonly value: string;
  readonly generation: number;
}

interface ValidatedConfig {
  readonly image: string;
  readonly imageDigest: string;
  readonly env: Record<string, string>;
  readonly port: number;
  readonly credentials?: BotSandboxCredentials;
}

interface HealthResult {
  readonly ready: boolean;
  readonly detail: string;
}

/**
 * Every value `typeof` reports as something other than an object.
 *
 * `null` is deliberately absent: `typeof null` is `"object"`, so the caller
 * rejects it with its own explicit comparison, exactly as before. `z.number()`
 * rejects the non-finite doubles, so `NaN` and both infinities are matched
 * separately — otherwise a non-finite `botEnv` would slip past this gate and
 * fail later with the wrong diagnostic.
 */
const nonObjectSchema = z.union([
  z.string(),
  z.boolean(),
  z.number(),
  z.nan(),
  z.literal(Number.POSITIVE_INFINITY),
  z.literal(Number.NEGATIVE_INFINITY),
  z.bigint(),
  z.symbol(),
  z.undefined(),
  z.function(),
]);

/** Env values arrive as strings; anything else is a caller error. */
const envValueSchema = z.string();

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof APIError && cause.response.status === 404;
}

function isAlreadyStopped(cause: unknown): boolean {
  return cause instanceof APIError && cause.response.status === 410;
}

function immutableImageDigest(image: string): string | undefined {
  const match = /@sha256:([a-f0-9]{64})$/u.exec(image);
  return match?.[1];
}

function validateImage(
  image: string,
): Result<{ readonly image: string; readonly digest: string }, InvalidBotSandboxConfig> {
  if (image !== image.trim() || /\s/u.test(image)) {
    return Result.err(
      new InvalidBotSandboxConfig({ field: "BOT_IMAGE", detail: "must not contain whitespace" }),
    );
  }
  const digest = immutableImageDigest(image);
  if (digest === undefined) {
    return Result.err(
      new InvalidBotSandboxConfig({
        field: "BOT_IMAGE",
        detail:
          "must end in @sha256:<64 lowercase hex characters>; tags and bare repositories are mutable",
      }),
    );
  }
  const repository = image.slice(0, -("@sha256:".length + digest.length));
  if (
    repository.length === 0 ||
    repository.startsWith("/") ||
    repository.endsWith("/") ||
    !/^[a-z0-9][a-z0-9._/-]*$/u.test(repository)
  ) {
    return Result.err(
      new InvalidBotSandboxConfig({
        field: "BOT_IMAGE",
        detail: "has an invalid VCR repository name",
      }),
    );
  }
  return Result.ok({ image, digest });
}

function validateBotEnv(
  source: BotProcessEnvironment,
): Result<
  { readonly env: Record<string, string>; readonly port: number },
  InvalidBotSandboxConfig
> {
  if (nonObjectSchema.safeParse(source).success || source === null) {
    return Result.err(new InvalidBotSandboxConfig({ field: "botEnv", detail: "must be a record" }));
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      return Result.err(
        new InvalidBotSandboxConfig({
          field: "botEnv",
          detail: `contains an invalid variable name: ${key}`,
        }),
      );
    }
    if (!envValueSchema.safeParse(value).success || value.includes("\0")) {
      return Result.err(
        new InvalidBotSandboxConfig({
          field: "botEnv",
          detail: `${key} must be a string without NUL characters`,
        }),
      );
    }
    env[key] = value;
  }
  for (const key of REQUIRED_BOT_ENV_KEYS) {
    if (!env[key]?.trim()) {
      return Result.err(
        new InvalidBotSandboxConfig({
          field: "botEnv",
          detail: `${key} must be present and non-empty`,
        }),
      );
    }
  }

  const portText = env["PORT"] ?? String(BOT_PORT_DEFAULT);
  const port = Number(portText);
  if (!/^\d{1,5}$/u.test(portText) || port < 1 || port > 65_535) {
    return Result.err(
      new InvalidBotSandboxConfig({
        field: "botEnv",
        detail: "PORT must be an integer between 1 and 65535",
      }),
    );
  }
  env["PORT"] = String(port);
  return Result.ok({ env, port });
}

function validateCredentials(
  credentials: BotSandboxCredentials | undefined,
): Result<BotSandboxCredentials | undefined, InvalidBotSandboxConfig> {
  if (credentials === undefined) return Result.ok(undefined);
  for (const key of ["token", "teamId", "projectId"] as const) {
    if (!credentials[key].trim()) {
      return Result.err(
        new InvalidBotSandboxConfig({
          field: "credentials",
          detail: `${key} must be non-empty when explicit credentials are supplied`,
        }),
      );
    }
  }
  return Result.ok(credentials);
}

function validateConfig(
  deps: BotSandboxSupervisorDeps,
): Result<ValidatedConfig, InvalidBotSandboxConfig> {
  const image = validateImage(deps.image);
  if (Result.isError(image)) return image;
  const bot = validateBotEnv(deps.botEnv);
  if (Result.isError(bot)) return bot;
  const credentials = validateCredentials(deps.credentials);
  if (Result.isError(credentials)) return credentials;

  return Result.ok({
    image: image.value.image,
    imageDigest: image.value.digest,
    env: bot.value.env,
    port: bot.value.port,
    ...(credentials.value === undefined ? {} : { credentials: credentials.value }),
  });
}

function createSandboxApi(credentials?: BotSandboxCredentials): SandboxApi {
  const auth = credentials ?? {};
  return {
    create: (input) => Sandbox.create({ ...input, ...auth }),
    get: (input) => Sandbox.get({ ...input, ...auth }),
    list: (input) => Sandbox.list({ ...input, ...auth }),
  };
}

/**
 * What `ACQUIRE_MUTEX_SCRIPT` returns from `cjson.encode`. Upstash hands it back
 * either as that JSON text or as an already-deserialized object, so both are
 * accepted; the Lua `INCR` result may likewise arrive as a number or as text.
 */
const leaseSchema = storedJson(
  z.looseObject({
    lease: z.string().min(1),
    generation: storedInt.pipe(z.int().min(1)),
  }),
).transform((decoded): Lease => ({ value: decoded.lease, generation: decoded.generation }));

function parseLease(raw: unknown): Lease | undefined {
  return leaseSchema.safeParse(raw).data;
}

function healthUrlFor(sandbox: SdkSandbox, port: number): string {
  const url = new URL(sandbox.domain(port));
  if (url.protocol !== "https:") throw new Error("sandbox health domain is not HTTPS");
  url.username = "";
  url.password = "";
  url.pathname = HEALTH_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function validHealthPayload(value: unknown): boolean {
  return readyHealthReportSchema.safeParse(value).success;
}

async function checkHealth(healthUrl: string): Promise<HealthResult> {
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      return { ready: false, detail: `GET /health returned ${response.status}` };
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return { ready: false, detail: "GET /health did not return application/json" };
    }
    const text = await response.text();
    if (text.length > 4_096) {
      return { ready: false, detail: "GET /health response exceeded 4096 characters" };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ready: false, detail: "GET /health returned invalid JSON" };
    }
    return validHealthPayload(body)
      ? { ready: true, detail: "ready" }
      : { ready: false, detail: "GET /health returned an invalid or not-ready report" };
  } catch (cause) {
    return { ready: false, detail: detailOf(cause) };
  }
}

async function acquireLease(
  redis: SupervisorRedis,
  owner: string,
): Promise<Result<Lease, BotSupervisorBusy | BotSupervisorCoordinationFailed>> {
  try {
    const raw: unknown = await redis.eval(
      ACQUIRE_MUTEX_SCRIPT,
      [BOT_SUPERVISOR_MUTEX_KEY, BOT_SUPERVISOR_FENCE_KEY],
      [owner, MUTEX_TTL_MS],
    );
    if (!raw) {
      return Result.err(new BotSupervisorBusy());
    }
    const lease = parseLease(raw);
    return lease === undefined
      ? Result.err(
          new BotSupervisorCoordinationFailed({
            operation: "acquire",
            detail: "Redis returned a malformed lease",
          }),
        )
      : Result.ok(lease);
  } catch (cause) {
    return Result.err(
      new BotSupervisorCoordinationFailed({
        operation: "acquire",
        detail: detailOf(cause),
      }),
    );
  }
}

async function renewLease(
  redis: SupervisorRedis,
  lease: Lease,
  stage: string,
): Promise<Result<void, BotSupervisorCoordinationFailed | BotSupervisorFenceLost>> {
  try {
    const renewed = Number(
      await redis.eval(RENEW_MUTEX_SCRIPT, [BOT_SUPERVISOR_MUTEX_KEY], [lease.value, MUTEX_TTL_MS]),
    );
    return renewed === 1
      ? Result.ok(undefined)
      : Result.err(new BotSupervisorFenceLost({ generation: lease.generation, stage }));
  } catch (cause) {
    return Result.err(
      new BotSupervisorCoordinationFailed({
        operation: "renew",
        detail: detailOf(cause),
      }),
    );
  }
}

async function releaseLease(
  redis: SupervisorRedis,
  lease: Lease,
): Promise<Result<void, BotSupervisorCoordinationFailed | BotSupervisorFenceLost>> {
  try {
    const released = Number(
      await redis.eval(RELEASE_MUTEX_SCRIPT, [BOT_SUPERVISOR_MUTEX_KEY], [lease.value]),
    );
    return released === 1
      ? Result.ok(undefined)
      : Result.err(new BotSupervisorFenceLost({ generation: lease.generation, stage: "release" }));
  } catch (cause) {
    return Result.err(
      new BotSupervisorCoordinationFailed({
        operation: "release",
        detail: detailOf(cause),
      }),
    );
  }
}

async function readActive(
  redis: SupervisorRedis,
): Promise<
  Result<
    ActiveBotGeneration | undefined,
    BotSupervisorCoordinationFailed | InvalidBotActiveGeneration
  >
> {
  let raw: unknown;
  try {
    raw = await redis.get(BOT_ACTIVE_GENERATION_KEY);
  } catch (cause) {
    return Result.err(
      new BotSupervisorCoordinationFailed({
        operation: "read-active",
        detail: detailOf(cause),
      }),
    );
  }
  try {
    return Result.ok(decodeActiveBotGeneration(raw));
  } catch (cause) {
    return Result.err(new InvalidBotActiveGeneration(detailOf(cause)));
  }
}

async function commitGeneration(
  redis: SupervisorRedis,
  lease: Lease,
  previous: ActiveBotGeneration | undefined,
  next: ActiveBotGeneration,
): Promise<
  Result<
    void,
    BotSupervisorCoordinationFailed | BotSupervisorFenceLost | InvalidBotActiveGeneration
  >
> {
  try {
    const committed = Number(
      await redis.eval(
        COMMIT_GENERATION_SCRIPT,
        [BOT_SUPERVISOR_MUTEX_KEY, BOT_ACTIVE_GENERATION_KEY],
        [
          lease.value,
          previous === undefined ? "" : String(previous.generation),
          previous?.sandboxName ?? "",
          JSON.stringify(next),
          lease.generation,
        ],
      ),
    );
    if (committed === 1) return Result.ok(undefined);
    if (committed === -1) {
      return Result.err(
        new BotSupervisorFenceLost({ generation: lease.generation, stage: "commit" }),
      );
    }
    return Result.err(
      new InvalidBotActiveGeneration(
        committed === -2
          ? "new generation did not advance the fencing token"
          : "active generation changed while the candidate was starting",
      ),
    );
  } catch (cause) {
    return Result.err(
      new BotSupervisorCoordinationFailed({
        operation: "commit",
        detail: detailOf(cause),
      }),
    );
  }
}

async function inspectActive(
  client: SandboxApi,
  active: ActiveBotGeneration,
): Promise<Result<SdkSandbox | undefined, BotSandboxOperationFailed>> {
  try {
    return Result.ok(await client.get({ name: active.sandboxName, resume: false }));
  } catch (cause) {
    if (isNotFound(cause)) return Result.ok(undefined);
    return Result.err(
      new BotSandboxOperationFailed({
        operation: "inspect-active",
        sandboxName: active.sandboxName,
        detail: detailOf(cause),
      }),
    );
  }
}

function sandboxMatches(
  sandbox: SdkSandbox,
  active: ActiveBotGeneration,
  desiredImage: string,
  desiredDigest: string,
): boolean {
  return (
    sandbox.name === active.sandboxName &&
    sandbox.status === "running" &&
    !sandbox.persistent &&
    sandbox.vcpus === 1 &&
    active.image === desiredImage &&
    immutableImageDigest(sandbox.image ?? "") === desiredDigest
  );
}

async function terminateSandbox(
  sandbox: SdkSandbox,
  commandId: string | undefined,
): Promise<readonly string[]> {
  const issues: string[] = [];
  if (commandId !== undefined) {
    try {
      const command = await sandbox.getCommand(commandId);
      await command.kill("SIGTERM", {
        abortSignal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
      });
      try {
        await command.wait({ signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS) });
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "TimeoutError")) {
          issues.push(`drain ${sandbox.name}: ${detailOf(cause)}`);
        }
      }
    } catch (cause) {
      issues.push(`SIGTERM ${sandbox.name}: ${detailOf(cause)}`);
    }
  }

  try {
    await sandbox.stop({ signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS) });
  } catch (cause) {
    if (!isAlreadyStopped(cause)) issues.push(`stop ${sandbox.name}: ${detailOf(cause)}`);
  }
  try {
    await sandbox.delete({ signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS) });
  } catch (cause) {
    if (!isNotFound(cause)) issues.push(`delete ${sandbox.name}: ${detailOf(cause)}`);
  }
  return issues;
}

async function sweepOrphans(
  client: SandboxApi,
  activeName: string,
  maximumGeneration: number,
): Promise<Result<void, BotSandboxOperationFailed | BotSandboxCleanupFailed>> {
  let listed: SdkSandboxPaginator;
  try {
    listed = await client.list({ tags: { ...MANAGED_TAGS } });
  } catch (cause) {
    return Result.err(
      new BotSandboxOperationFailed({
        operation: "list-orphans",
        detail: detailOf(cause),
      }),
    );
  }

  const issues: string[] = [];
  try {
    for await (const entry of listed) {
      if (entry.name === activeName) continue;
      const generationTag = entry.tags?.["generation"];
      const taggedGeneration = Number(generationTag);
      // A lease may expire during a long sweep. Never let its stale owner
      // delete a candidate fenced by a supervisor that acquired a newer lease,
      // or anything whose fencing tag is missing/malformed.
      if (
        generationTag === undefined ||
        !/^[1-9]\d*$/u.test(generationTag) ||
        !Number.isSafeInteger(taggedGeneration) ||
        taggedGeneration > maximumGeneration
      ) {
        continue;
      }
      try {
        const orphan = await client.get({ name: entry.name, resume: false });
        issues.push(...(await terminateSandbox(orphan, undefined)));
      } catch (cause) {
        if (!isNotFound(cause)) issues.push(`inspect orphan ${entry.name}: ${detailOf(cause)}`);
      }
    }
  } catch (cause) {
    return Result.err(
      new BotSandboxOperationFailed({
        operation: "list-orphans",
        detail: detailOf(cause),
      }),
    );
  }
  return issues.length === 0
    ? Result.ok(undefined)
    : Result.err(new BotSandboxCleanupFailed(issues));
}

function candidateName(): string {
  const suffix = crypto.randomUUID().replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/u.test(suffix)) {
    throw new Error("randomUUID returned an invalid UUID");
  }
  return `wack-bot-${suffix.slice(0, 20)}`;
}

export function createBotSandboxSupervisor(deps: BotSandboxSupervisorDeps): BotSandboxSupervisor {
  return {
    ensure: async () => {
      const validated = validateConfig(deps);
      if (Result.isError(validated)) return validated;
      const config = validated.value;
      const client = createSandboxApi(config.credentials);

      let owner: string;
      try {
        owner = crypto.randomUUID();
      } catch (cause) {
        return Result.err(
          new BotSandboxOperationFailed({
            operation: "reconcile",
            detail: `could not create supervisor identity: ${detailOf(cause)}`,
          }),
        );
      }
      const acquired = await acquireLease(deps.redis, owner);
      if (Result.isError(acquired)) return acquired;
      const lease = acquired.value;

      let result: Result<BotSandboxSupervisorOutcome, BotSandboxSupervisorError>;
      try {
        result = await reconcile({ redis: deps.redis, lease, config, client });
      } catch (cause) {
        result = Result.err(
          new BotSandboxOperationFailed({
            operation: "reconcile",
            detail: detailOf(cause),
          }),
        );
      }

      const released = await releaseLease(deps.redis, lease);
      return Result.isError(released) ? released : result;
    },
  };
}

interface ReconcileInput {
  readonly redis: SupervisorRedis;
  readonly lease: Lease;
  readonly config: ValidatedConfig;
  readonly client: SandboxApi;
}

interface PreviousGeneration {
  readonly record: ActiveBotGeneration | undefined;
  readonly sandbox: SdkSandbox | undefined;
}

interface CreatedCandidate {
  readonly requestedName: string;
  readonly sandbox: SdkSandbox;
}

interface ReadyCandidate {
  readonly sandbox: SdkSandbox;
  readonly command: SdkBotCommand;
  readonly healthUrl: string;
  readonly expiresAt: Date;
}

async function inspectPrevious(
  input: ReconcileInput,
): Promise<Result<PreviousGeneration, BotSandboxSupervisorError>> {
  const active = await readActive(input.redis);
  if (Result.isError(active)) return active;
  if (active.value === undefined) {
    return Result.ok({ record: undefined, sandbox: undefined });
  }
  const sandbox = await inspectActive(input.client, active.value);
  return Result.isError(sandbox)
    ? sandbox
    : Result.ok({ record: active.value, sandbox: sandbox.value });
}

async function useHealthyActive(
  input: ReconcileInput,
  previous: PreviousGeneration,
): Promise<
  Result<
    Extract<BotSandboxSupervisorOutcome, { status: "healthy" }> | undefined,
    BotSandboxSupervisorError
  >
> {
  const { record, sandbox } = previous;
  if (
    record === undefined ||
    sandbox === undefined ||
    !sandboxMatches(sandbox, record, input.config.image, input.config.imageDigest)
  ) {
    return Result.ok(undefined);
  }
  const remainingMs = (sandbox.expiresAt?.getTime() ?? 0) - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= BOT_SANDBOX_REFRESH_WINDOW_MS) {
    return Result.ok(undefined);
  }

  let healthUrl: string;
  try {
    healthUrl = healthUrlFor(sandbox, input.config.port);
  } catch (cause) {
    return Result.err(
      new BotSandboxOperationFailed({
        operation: "inspect-active",
        sandboxName: sandbox.name,
        detail: detailOf(cause),
      }),
    );
  }
  // The Redis endpoint is consumed by the agent, while this URL comes from
  // the inspected Sandbox. A record pointing anywhere else must be rotated
  // even when the Sandbox itself is healthy.
  if (record.healthUrl !== healthUrl) return Result.ok(undefined);

  const health = await checkHealth(healthUrl);
  if (!health.ready) return Result.ok(undefined);

  const renewed = await renewLease(input.redis, input.lease, "before orphan sweep");
  if (Result.isError(renewed)) return renewed;
  const swept = await sweepOrphans(input.client, record.sandboxName, input.lease.generation);
  return Result.isError(swept)
    ? swept
    : Result.ok({ status: "healthy", active: record, remainingMs });
}

async function cleanupUnhealthyCandidate(
  sandbox: SdkSandbox,
  detail: string,
  commandId?: string,
): Promise<Result<never, BotSandboxUnhealthy>> {
  const cleanupIssues = await terminateSandbox(sandbox, commandId);
  return Result.err(new BotSandboxUnhealthy({ sandboxName: sandbox.name, detail, cleanupIssues }));
}

async function createCandidate(
  input: ReconcileInput,
): Promise<Result<CreatedCandidate, BotSandboxSupervisorError>> {
  const renewed = await renewLease(input.redis, input.lease, "before candidate creation");
  if (Result.isError(renewed)) return renewed;

  let name: string;
  try {
    name = candidateName();
  } catch (cause) {
    return Result.err(
      new BotSandboxOperationFailed({ operation: "create-candidate", detail: detailOf(cause) }),
    );
  }
  try {
    const sandbox = await input.client.create({
      name,
      image: input.config.image,
      ports: [input.config.port],
      timeout: BOT_SANDBOX_TIMEOUT_MS,
      resources: { vcpus: 1 },
      persistent: false,
      env: { ...input.config.env },
      tags: { ...MANAGED_TAGS, generation: String(input.lease.generation) },
    });
    return Result.ok({ requestedName: name, sandbox });
  } catch (cause) {
    return Result.err(
      new BotSandboxOperationFailed({
        operation: "create-candidate",
        sandboxName: name,
        detail: detailOf(cause),
      }),
    );
  }
}

async function waitForCandidateHealth(
  input: ReconcileInput,
  sandboxName: string,
  healthUrl: string,
): Promise<Result<void, BotSandboxSupervisorError>> {
  const deadline = Date.now() + HEALTH_READY_TIMEOUT_MS;
  let lastHealth = "health check was not attempted";
  do {
    const renewed = await renewLease(input.redis, input.lease, "candidate health polling");
    if (Result.isError(renewed)) return renewed;

    const health = await checkHealth(healthUrl);
    lastHealth = health.detail;
    if (health.ready) return Result.ok(undefined);
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(HEALTH_POLL_INTERVAL_MS, remaining));
  } while (Date.now() < deadline);

  return Result.err(new BotSandboxUnhealthy({ sandboxName, detail: lastHealth }));
}

async function startCandidate(
  input: ReconcileInput,
  created: CreatedCandidate,
): Promise<Result<ReadyCandidate, BotSandboxSupervisorError>> {
  const candidate = created.sandbox;
  const renewed = await renewLease(input.redis, input.lease, "after candidate creation");
  if (Result.isError(renewed)) {
    await terminateSandbox(candidate, undefined);
    return renewed;
  }

  const expiresAt = candidate.expiresAt;
  if (
    candidate.name !== created.requestedName ||
    candidate.status !== "running" ||
    candidate.persistent ||
    candidate.vcpus !== 1 ||
    immutableImageDigest(candidate.image ?? "") !== input.config.imageDigest ||
    expiresAt === undefined ||
    !Number.isFinite(expiresAt.getTime())
  ) {
    return cleanupUnhealthyCandidate(
      candidate,
      "Vercel returned candidate metadata that did not match the request",
    );
  }

  let command: SdkBotCommand;
  try {
    command = await candidate.runCommand({
      cmd: "bun",
      args: ["--preload", "src/instrument.ts", "run", "src/index.ts"],
      cwd: "/app/packages/bot",
      detached: true,
    });
  } catch (cause) {
    return cleanupUnhealthyCandidate(candidate, `could not start bot command: ${detailOf(cause)}`);
  }

  let healthUrl: string;
  try {
    healthUrl = healthUrlFor(candidate, input.config.port);
  } catch (cause) {
    return cleanupUnhealthyCandidate(candidate, detailOf(cause), command.cmdId);
  }
  const ready = await waitForCandidateHealth(input, candidate.name, healthUrl);
  if (Result.isError(ready)) {
    if (BotSandboxUnhealthy.is(ready.error)) {
      return cleanupUnhealthyCandidate(candidate, ready.error.detail, command.cmdId);
    }
    await terminateSandbox(candidate, command.cmdId);
    return ready;
  }
  return Result.ok({ sandbox: candidate, command, healthUrl, expiresAt });
}

async function activateCandidate(
  input: ReconcileInput,
  previous: PreviousGeneration,
  candidate: ReadyCandidate,
): Promise<Result<BotSandboxSupervisorOutcome, BotSandboxSupervisorError>> {
  const renewed = await renewLease(input.redis, input.lease, "before generation commit");
  if (Result.isError(renewed)) {
    await terminateSandbox(candidate.sandbox, candidate.command.cmdId);
    return renewed;
  }

  const next: ActiveBotGeneration = {
    version: 1,
    generation: input.lease.generation,
    sandboxName: candidate.sandbox.name,
    commandId: candidate.command.cmdId,
    image: input.config.image,
    healthUrl: candidate.healthUrl,
    activatedAt: new Date().toISOString(),
    expiresAt: candidate.expiresAt.toISOString(),
  };
  const committed = await commitGeneration(input.redis, input.lease, previous.record, next);
  if (Result.isError(committed)) {
    await terminateSandbox(candidate.sandbox, candidate.command.cmdId);
    return committed;
  }

  const cleanupIssues: string[] = [];
  if (previous.sandbox !== undefined && previous.sandbox.name !== candidate.sandbox.name) {
    cleanupIssues.push(...(await terminateSandbox(previous.sandbox, previous.record?.commandId)));
  }
  const swept = await sweepOrphans(input.client, candidate.sandbox.name, input.lease.generation);
  if (Result.isError(swept)) cleanupIssues.push(swept.error.message);
  if (cleanupIssues.length > 0) {
    return Result.err(new BotSandboxCleanupFailed(cleanupIssues));
  }
  return Result.ok({
    status: "replaced",
    active: next,
    ...(previous.record === undefined ? {} : { previousSandboxName: previous.record.sandboxName }),
  });
}

async function reconcile(
  input: ReconcileInput,
): Promise<Result<BotSandboxSupervisorOutcome, BotSandboxSupervisorError>> {
  const previous = await inspectPrevious(input);
  if (Result.isError(previous)) return previous;
  const healthy = await useHealthyActive(input, previous.value);
  if (Result.isError(healthy)) return healthy;
  if (healthy.value !== undefined) return Result.ok(healthy.value);

  const created = await createCandidate(input);
  if (Result.isError(created)) return created;
  const ready = await startCandidate(input, created.value);
  return Result.isError(ready) ? ready : activateCandidate(input, previous.value, ready.value);
}
