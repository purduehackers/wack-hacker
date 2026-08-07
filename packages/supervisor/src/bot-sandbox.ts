/**
 * Fenced Vercel Sandbox supervisor for the long-running Discord bot.
 *
 * Redis is the authority for both mutual exclusion and the active generation.
 * A sandbox is never made active until its structured `/health` response says
 * that the Discord gateway is ready. The bot token and the rest of the bot's
 * already-validated environment are explicit dependencies; this module never
 * reads an agent or bot environment singleton.
 */

import { APIError, Sandbox } from "@vercel/sandbox";

import {
  BOT_ACTIVE_GENERATION_KEY,
  type ActiveBotGeneration,
} from "../../shared/src/bot-generation.ts";
import type { RedisClient } from "../../shared/src/redis/client.ts";
import { Result, TaggedError } from "../../shared/src/result/index.ts";

export { BOT_ACTIVE_GENERATION_KEY } from "../../shared/src/bot-generation.ts";

const BOT_PORT_DEFAULT = 8080;
export const BOT_SANDBOX_TIMEOUT_MS = 24 * 60 * 60_000;
export const BOT_SANDBOX_REFRESH_WINDOW_MS = 30 * 60_000;

const HEALTH_PATH = "/health";
const HEALTH_READY_TIMEOUT_MS = 2 * 60_000;
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const HEALTH_POLL_INTERVAL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 20_000;
const MUTEX_TTL_MS = 10 * 60_000;

export const BOT_SUPERVISOR_MUTEX_KEY = "wack:bot-sandbox:supervisor:v1";
export const BOT_SUPERVISOR_FENCE_KEY = "wack:bot-sandbox:fence:v1";

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

export type BotSandboxOperation =
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

/** Explicit access-token credentials. Omit this record to use Vercel OIDC. */
type SandboxCreateParams = NonNullable<Parameters<typeof Sandbox.create>[0]>;
type SandboxGetParams = Parameters<typeof Sandbox.get>[0];
type SandboxListParams = NonNullable<Parameters<typeof Sandbox.list>[0]>;
type SdkSandbox = Awaited<ReturnType<typeof Sandbox.get>>;
type SdkSandboxPaginator = Awaited<ReturnType<typeof Sandbox.list>>;
type SdkBotCommand = Awaited<ReturnType<SdkSandbox["getCommand"]>>;

export type BotSandboxCredentials = Pick<
  Extract<SandboxCreateParams, { readonly token: string }>,
  "token" | "teamId" | "projectId"
>;

/** The command operations used by the supervisor, projected from the SDK. */
export interface ManagedBotCommand extends Pick<SdkBotCommand, "cmdId"> {
  readonly kill: (...input: Parameters<SdkBotCommand["kill"]>) => Promise<void>;
  readonly wait: (...input: Parameters<SdkBotCommand["wait"]>) => Promise<unknown>;
}

/**
 * The managed Sandbox surface used by the supervisor. Keeping this projection
 * exported makes in-memory test clients strict without constructing SDK
 * classes that have private state.
 */
export interface ManagedBotSandbox extends Pick<
  SdkSandbox,
  "name" | "status" | "persistent" | "vcpus" | "image" | "expiresAt" | "tags" | "domain" | "delete"
> {
  readonly runCommand: (
    input: Extract<Parameters<SdkSandbox["runCommand"]>[0], object> & { readonly detached: true },
  ) => Promise<ManagedBotCommand>;
  readonly getCommand: (
    ...input: Parameters<SdkSandbox["getCommand"]>
  ) => Promise<ManagedBotCommand>;
  readonly stop: (...input: Parameters<SdkSandbox["stop"]>) => Promise<unknown>;
}

export type ManagedBotSandboxListEntry =
  SdkSandboxPaginator extends AsyncIterable<infer Entry> ? Entry : never;

/**
 * Narrow injectable SDK seam. Every parameter and Sandbox member is projected
 * from @vercel/sandbox rather than restating its API types.
 */
export interface BotSandboxClient {
  readonly create: (input: SandboxCreateParams) => Promise<ManagedBotSandbox>;
  readonly get: (input: SandboxGetParams) => Promise<ManagedBotSandbox>;
  readonly list: (input: SandboxListParams) => Promise<AsyncIterable<ManagedBotSandboxListEntry>>;
}

/**
 * Redis commands required for fencing and active-generation coordination.
 * Results stay unknown because the supervisor validates every response; the
 * parameters remain projected from the upstream client.
 */
export interface BotSandboxRedisClient {
  readonly eval: (...input: Parameters<RedisClient["eval"]>) => Promise<unknown>;
  readonly get: (...input: Parameters<RedisClient["get"]>) => Promise<unknown>;
}

export type BotProcessEnvironment = Readonly<Record<string, string>> & {
  readonly DISCORD_BOT_TOKEN: string;
  readonly DISCORD_BOT_CLIENT_ID: string;
  readonly AGENT_URL: string;
  readonly AGENT_INGRESS_SECRET: string;
  readonly BOT_INGRESS_SECRET: string;
  readonly UPSTASH_REDIS_REST_URL: string;
  readonly UPSTASH_REDIS_REST_TOKEN: string;
  readonly PRIVACY_DB_API_KEY: string;
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
  "PRIVACY_DB_API_KEY",
  "VERCEL_API_TOKEN",
  "DASHBOARD_EDGE_CONFIG",
  "PAYLOAD_CMS_API_KEY",
  "SHIP_API_KEY",
  "PHACK_API_TOKEN",
  "GROQ_API_KEY",
] as const satisfies readonly (keyof BotProcessEnvironment)[];

export interface BotSandboxSupervisorDeps {
  readonly redis: BotSandboxRedisClient;
  /** Digest-pinned VCR image. Tags, including `latest`, are rejected. */
  readonly image: string;
  /** A validated bot-process record supplied by the composition root. */
  readonly botEnv: BotProcessEnvironment;
  /** Omit on Vercel to use project OIDC. */
  readonly credentials?: BotSandboxCredentials;
  /** Test seam. Production uses @vercel/sandbox directly. */
  readonly sandboxClient?: BotSandboxClient;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly randomUUID?: () => string;
  readonly healthReadyTimeoutMs?: number;
  readonly healthPollIntervalMs?: number;
  readonly healthRequestTimeoutMs?: number;
  readonly drainTimeoutMs?: number;
  readonly mutexTtlMs?: number;
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

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
  if (typeof source !== "object" || source === null) {
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
    if (typeof value !== "string" || value.includes("\0")) {
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

function createSandboxClient(credentials?: BotSandboxCredentials): BotSandboxClient {
  const auth = credentials ?? {};
  return {
    create: (input) => Sandbox.create({ ...input, ...auth }),
    get: (input) => Sandbox.get({ ...input, ...auth }),
    list: (input) => Sandbox.list({ ...input, ...auth }),
  };
}

function parseLease(raw: unknown): Lease | undefined {
  if (!raw) return undefined;
  let decoded: unknown = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof decoded !== "object" || decoded === null) return undefined;
  const value = Reflect.get(decoded, "lease");
  const generation = Number(Reflect.get(decoded, "generation"));
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    return undefined;
  }
  return { value, generation };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function activeStringFields(
  decoded: object,
): Result<Omit<ActiveBotGeneration, "generation" | "version">, InvalidBotActiveGeneration> {
  const sandboxName = Reflect.get(decoded, "sandboxName");
  const commandId = Reflect.get(decoded, "commandId");
  const image = Reflect.get(decoded, "image");
  const healthUrl = Reflect.get(decoded, "healthUrl");
  const activatedAt = Reflect.get(decoded, "activatedAt");
  const expiresAt = Reflect.get(decoded, "expiresAt");
  if (
    !isNonEmptyString(sandboxName) ||
    !isNonEmptyString(commandId) ||
    !isNonEmptyString(image) ||
    !isNonEmptyString(healthUrl) ||
    !isNonEmptyString(activatedAt) ||
    !isNonEmptyString(expiresAt)
  ) {
    return Result.err(
      new InvalidBotActiveGeneration("all string fields must be present and non-empty"),
    );
  }
  return Result.ok({ sandboxName, commandId, image, healthUrl, activatedAt, expiresAt });
}

function parseActiveGeneration(
  raw: unknown,
): Result<ActiveBotGeneration | undefined, InvalidBotActiveGeneration> {
  if (raw === null || raw === undefined) return Result.ok(undefined);
  let decoded: unknown = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw);
    } catch {
      return Result.err(new InvalidBotActiveGeneration("record is not valid JSON"));
    }
  }
  if (typeof decoded !== "object" || decoded === null) {
    return Result.err(new InvalidBotActiveGeneration("record is not an object"));
  }

  if (Reflect.get(decoded, "version") !== 1) {
    return Result.err(new InvalidBotActiveGeneration("version must be 1"));
  }
  const generation = Reflect.get(decoded, "generation");
  if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) {
    return Result.err(new InvalidBotActiveGeneration("generation must be a positive safe integer"));
  }
  const fields = activeStringFields(decoded);
  if (Result.isError(fields)) return fields;
  const value = fields.value;
  if (immutableImageDigest(value.image) === undefined) {
    return Result.err(new InvalidBotActiveGeneration("image is not digest-pinned"));
  }
  try {
    const url = new URL(value.healthUrl);
    if (
      url.protocol !== "https:" ||
      url.pathname !== HEALTH_PATH ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return Result.err(
        new InvalidBotActiveGeneration(
          "healthUrl must be an HTTPS /health URL without credentials, query, or fragment",
        ),
      );
    }
  } catch {
    return Result.err(new InvalidBotActiveGeneration("healthUrl is not a valid URL"));
  }
  if (!Number.isFinite(Date.parse(value.activatedAt))) {
    return Result.err(new InvalidBotActiveGeneration("activatedAt is not an ISO timestamp"));
  }
  if (!Number.isFinite(Date.parse(value.expiresAt))) {
    return Result.err(new InvalidBotActiveGeneration("expiresAt is not an ISO timestamp"));
  }
  return Result.ok({ version: 1, generation, ...value });
}

function healthUrlFor(sandbox: ManagedBotSandbox, port: number): string {
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
  if (typeof value !== "object" || value === null) return false;
  const ready = Reflect.get(value, "ready");
  const ping = Reflect.get(value, "websocketPingMs");
  const uptime = Reflect.get(value, "uptimeSeconds");
  return (
    typeof ready === "boolean" &&
    ready &&
    typeof ping === "number" &&
    Number.isFinite(ping) &&
    Number.isInteger(ping) &&
    ping >= -1 &&
    typeof uptime === "number" &&
    Number.isSafeInteger(uptime) &&
    uptime >= 0
  );
}

async function checkHealth(
  doFetch: typeof globalThis.fetch,
  healthUrl: string,
  requestTimeoutMs: number,
): Promise<HealthResult> {
  try {
    const response = await doFetch(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
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
  redis: BotSandboxRedisClient,
  owner: string,
  ttlMs: number,
): Promise<Result<Lease, BotSupervisorBusy | BotSupervisorCoordinationFailed>> {
  try {
    const raw: unknown = await redis.eval(
      ACQUIRE_MUTEX_SCRIPT,
      [BOT_SUPERVISOR_MUTEX_KEY, BOT_SUPERVISOR_FENCE_KEY],
      [owner, ttlMs],
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
  redis: BotSandboxRedisClient,
  lease: Lease,
  ttlMs: number,
  stage: string,
): Promise<Result<void, BotSupervisorCoordinationFailed | BotSupervisorFenceLost>> {
  try {
    const renewed = Number(
      await redis.eval(RENEW_MUTEX_SCRIPT, [BOT_SUPERVISOR_MUTEX_KEY], [lease.value, ttlMs]),
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
  redis: BotSandboxRedisClient,
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
  redis: BotSandboxRedisClient,
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
  return parseActiveGeneration(raw);
}

async function commitGeneration(
  redis: BotSandboxRedisClient,
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
  client: BotSandboxClient,
  active: ActiveBotGeneration,
): Promise<Result<ManagedBotSandbox | undefined, BotSandboxOperationFailed>> {
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
  sandbox: ManagedBotSandbox,
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
  sandbox: ManagedBotSandbox,
  commandId: string | undefined,
  drainTimeoutMs: number,
): Promise<readonly string[]> {
  const issues: string[] = [];
  if (commandId !== undefined) {
    try {
      const command = await sandbox.getCommand(commandId);
      await command.kill("SIGTERM", {
        abortSignal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
      });
      try {
        await command.wait({ signal: AbortSignal.timeout(drainTimeoutMs) });
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
  client: BotSandboxClient,
  activeName: string,
  maximumGeneration: number,
  drainTimeoutMs: number,
): Promise<Result<void, BotSandboxOperationFailed | BotSandboxCleanupFailed>> {
  let listed: AsyncIterable<ManagedBotSandboxListEntry>;
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
        issues.push(...(await terminateSandbox(orphan, undefined, drainTimeoutMs)));
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

function candidateName(randomUUID: () => string): string {
  const suffix = randomUUID().replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/u.test(suffix)) {
    throw new Error("randomUUID returned an invalid UUID");
  }
  return `wack-bot-${suffix.slice(0, 20)}`;
}

function validPositiveDuration(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createBotSandboxSupervisor(deps: BotSandboxSupervisorDeps): BotSandboxSupervisor {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const doFetch = deps.fetch ?? fetch;
  const readyTimeoutMs = validPositiveDuration(deps.healthReadyTimeoutMs, HEALTH_READY_TIMEOUT_MS);
  const pollIntervalMs = validPositiveDuration(deps.healthPollIntervalMs, HEALTH_POLL_INTERVAL_MS);
  const requestTimeoutMs = validPositiveDuration(
    deps.healthRequestTimeoutMs,
    HEALTH_REQUEST_TIMEOUT_MS,
  );
  const drainTimeoutMs = validPositiveDuration(deps.drainTimeoutMs, DRAIN_TIMEOUT_MS);
  const mutexTtlMs = validPositiveDuration(deps.mutexTtlMs, MUTEX_TTL_MS);

  return {
    ensure: async () => {
      const validated = validateConfig(deps);
      if (Result.isError(validated)) return validated;
      const config = validated.value;
      const client = deps.sandboxClient ?? createSandboxClient(config.credentials);

      let owner: string;
      try {
        owner = randomUUID();
      } catch (cause) {
        return Result.err(
          new BotSandboxOperationFailed({
            operation: "reconcile",
            detail: `could not create supervisor identity: ${detailOf(cause)}`,
          }),
        );
      }
      const acquired = await acquireLease(deps.redis, owner, mutexTtlMs);
      if (Result.isError(acquired)) return acquired;
      const lease = acquired.value;

      let result: Result<BotSandboxSupervisorOutcome, BotSandboxSupervisorError>;
      try {
        result = await reconcile({
          redis: deps.redis,
          lease,
          config,
          client,
          doFetch,
          now,
          sleep,
          randomUUID,
          readyTimeoutMs,
          pollIntervalMs,
          requestTimeoutMs,
          drainTimeoutMs,
          mutexTtlMs,
        });
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
  readonly redis: BotSandboxRedisClient;
  readonly lease: Lease;
  readonly config: ValidatedConfig;
  readonly client: BotSandboxClient;
  readonly doFetch: typeof globalThis.fetch;
  readonly now: () => Date;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly randomUUID: () => string;
  readonly readyTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly drainTimeoutMs: number;
  readonly mutexTtlMs: number;
}

interface PreviousGeneration {
  readonly record: ActiveBotGeneration | undefined;
  readonly sandbox: ManagedBotSandbox | undefined;
}

interface CreatedCandidate {
  readonly requestedName: string;
  readonly sandbox: ManagedBotSandbox;
}

interface ReadyCandidate {
  readonly sandbox: ManagedBotSandbox;
  readonly command: ManagedBotCommand;
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
  const remainingMs = (sandbox.expiresAt?.getTime() ?? 0) - input.now().getTime();
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

  const health = await checkHealth(input.doFetch, healthUrl, input.requestTimeoutMs);
  if (!health.ready) return Result.ok(undefined);

  const renewed = await renewLease(
    input.redis,
    input.lease,
    input.mutexTtlMs,
    "before orphan sweep",
  );
  if (Result.isError(renewed)) return renewed;
  const swept = await sweepOrphans(
    input.client,
    record.sandboxName,
    input.lease.generation,
    input.drainTimeoutMs,
  );
  return Result.isError(swept)
    ? swept
    : Result.ok({ status: "healthy", active: record, remainingMs });
}

async function cleanupUnhealthyCandidate(
  input: ReconcileInput,
  sandbox: ManagedBotSandbox,
  detail: string,
  commandId?: string,
): Promise<Result<never, BotSandboxUnhealthy>> {
  const cleanupIssues = await terminateSandbox(sandbox, commandId, input.drainTimeoutMs);
  return Result.err(new BotSandboxUnhealthy({ sandboxName: sandbox.name, detail, cleanupIssues }));
}

async function createCandidate(
  input: ReconcileInput,
): Promise<Result<CreatedCandidate, BotSandboxSupervisorError>> {
  const renewed = await renewLease(
    input.redis,
    input.lease,
    input.mutexTtlMs,
    "before candidate creation",
  );
  if (Result.isError(renewed)) return renewed;

  let name: string;
  try {
    name = candidateName(input.randomUUID);
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
  const deadline = input.now().getTime() + input.readyTimeoutMs;
  let lastHealth = "health check was not attempted";
  do {
    const renewed = await renewLease(
      input.redis,
      input.lease,
      input.mutexTtlMs,
      "candidate health polling",
    );
    if (Result.isError(renewed)) return renewed;

    const health = await checkHealth(input.doFetch, healthUrl, input.requestTimeoutMs);
    lastHealth = health.detail;
    if (health.ready) return Result.ok(undefined);
    const remaining = deadline - input.now().getTime();
    if (remaining > 0) await input.sleep(Math.min(input.pollIntervalMs, remaining));
  } while (input.now().getTime() < deadline);

  return Result.err(new BotSandboxUnhealthy({ sandboxName, detail: lastHealth }));
}

async function startCandidate(
  input: ReconcileInput,
  created: CreatedCandidate,
): Promise<Result<ReadyCandidate, BotSandboxSupervisorError>> {
  const candidate = created.sandbox;
  const renewed = await renewLease(
    input.redis,
    input.lease,
    input.mutexTtlMs,
    "after candidate creation",
  );
  if (Result.isError(renewed)) {
    await terminateSandbox(candidate, undefined, input.drainTimeoutMs);
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
      input,
      candidate,
      "Vercel returned candidate metadata that did not match the request",
    );
  }

  let command: ManagedBotCommand;
  try {
    command = await candidate.runCommand({
      cmd: "bun",
      args: ["--preload", "src/instrument.ts", "run", "src/index.ts"],
      cwd: "/app/packages/bot",
      detached: true,
    });
  } catch (cause) {
    return cleanupUnhealthyCandidate(
      input,
      candidate,
      `could not start bot command: ${detailOf(cause)}`,
    );
  }

  let healthUrl: string;
  try {
    healthUrl = healthUrlFor(candidate, input.config.port);
  } catch (cause) {
    return cleanupUnhealthyCandidate(input, candidate, detailOf(cause), command.cmdId);
  }
  const ready = await waitForCandidateHealth(input, candidate.name, healthUrl);
  if (Result.isError(ready)) {
    if (BotSandboxUnhealthy.is(ready.error)) {
      return cleanupUnhealthyCandidate(input, candidate, ready.error.detail, command.cmdId);
    }
    await terminateSandbox(candidate, command.cmdId, input.drainTimeoutMs);
    return ready;
  }
  return Result.ok({ sandbox: candidate, command, healthUrl, expiresAt });
}

async function activateCandidate(
  input: ReconcileInput,
  previous: PreviousGeneration,
  candidate: ReadyCandidate,
): Promise<Result<BotSandboxSupervisorOutcome, BotSandboxSupervisorError>> {
  const renewed = await renewLease(
    input.redis,
    input.lease,
    input.mutexTtlMs,
    "before generation commit",
  );
  if (Result.isError(renewed)) {
    await terminateSandbox(candidate.sandbox, candidate.command.cmdId, input.drainTimeoutMs);
    return renewed;
  }

  const next: ActiveBotGeneration = {
    version: 1,
    generation: input.lease.generation,
    sandboxName: candidate.sandbox.name,
    commandId: candidate.command.cmdId,
    image: input.config.image,
    healthUrl: candidate.healthUrl,
    activatedAt: input.now().toISOString(),
    expiresAt: candidate.expiresAt.toISOString(),
  };
  const committed = await commitGeneration(input.redis, input.lease, previous.record, next);
  if (Result.isError(committed)) {
    await terminateSandbox(candidate.sandbox, candidate.command.cmdId, input.drainTimeoutMs);
    return committed;
  }

  const cleanupIssues: string[] = [];
  if (previous.sandbox !== undefined && previous.sandbox.name !== candidate.sandbox.name) {
    cleanupIssues.push(
      ...(await terminateSandbox(
        previous.sandbox,
        previous.record?.commandId,
        input.drainTimeoutMs,
      )),
    );
  }
  const swept = await sweepOrphans(
    input.client,
    candidate.sandbox.name,
    input.lease.generation,
    input.drainTimeoutMs,
  );
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
