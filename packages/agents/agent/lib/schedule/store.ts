/** Durable scheduled-task storage and atomic libSQL lease settlement. */

import { createHash } from "node:crypto";

import type { Db, scheduledTasks } from "@repo/shared/db";
import { InvalidInput, InvariantViolated, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { Cron } from "croner";
import { z } from "zod";

import { discordSnowflake, jsonCodec } from "../schema.ts";

export const SCHEDULE_MAX_ATTEMPTS = 5;
const MAX_LISTED_TASKS = 50;
const MAX_ERROR_CHARS = 2_000;

type ScheduledTaskRow = typeof scheduledTasks.$inferSelect;
type ScheduledTaskInsert = typeof scheduledTasks.$inferInsert;

const ONCE = "once" satisfies ScheduledTaskRow["scheduleType"];
const RECURRING = "recurring" satisfies ScheduledTaskRow["scheduleType"];
const AGENT = "agent" satisfies ScheduledTaskRow["actionType"];
const MESSAGE = "message" satisfies ScheduledTaskRow["actionType"];
const ACTIVE = "active" satisfies ScheduledTaskRow["status"];
const CANCELLED = "cancelled" satisfies ScheduledTaskRow["status"];
const COMPLETED = "completed" satisfies ScheduledTaskRow["status"];
const FAILED = "failed" satisfies ScheduledTaskRow["status"];

type CreateScheduleBase = Readonly<Pick<ScheduledTaskInsert, "description" | "prompt">>;

export type ScheduleOwner = Readonly<
  Pick<ScheduledTaskInsert, "ownerId" | "channelId" | "memberRoles">
>;

export type CreateOnceSchedule = CreateScheduleBase & {
  readonly type: typeof ONCE;
  readonly runAt: Date;
};

export type CreateRecurringSchedule = CreateScheduleBase & {
  readonly cron: string;
  readonly timezone: string;
  readonly type: typeof RECURRING;
};

export type CreateScheduleInput = CreateOnceSchedule | CreateRecurringSchedule;

type NormalizeSqlNull<Shape, Keys extends keyof Shape> = Omit<Shape, Keys> & {
  readonly [Key in Keys]?: Exclude<Shape[Key], null>;
};

type ScheduledTaskViewRow = Pick<
  ScheduledTaskRow,
  | "actionType"
  | "channelId"
  | "createdAt"
  | "cron"
  | "description"
  | "fireCount"
  | "id"
  | "lastDispatchedAt"
  | "lastError"
  | "nextRunAt"
  | "prompt"
  | "scheduleType"
  | "status"
  | "timezone"
  | "updatedAt"
>;

type ScheduledTaskViewNullable = "cron" | "lastDispatchedAt" | "lastError" | "timezone";

export type ScheduledTaskView = Readonly<
  NormalizeSqlNull<ScheduledTaskViewRow, ScheduledTaskViewNullable>
>;

type ClaimedScheduleRow = Pick<
  ScheduledTaskRow,
  | "actionType"
  | "attemptCount"
  | "channelId"
  | "cron"
  | "description"
  | "id"
  | "memberRoles"
  | "nextRunAt"
  | "ownerId"
  | "prompt"
  | "scheduleType"
  | "timezone"
>;

type ClaimedScheduleNullable = "cron" | "memberRoles" | "timezone";

export type ClaimedSchedule = Readonly<
  NormalizeSqlNull<ClaimedScheduleRow, ClaimedScheduleNullable> & {
    leaseToken: string;
    occurrenceId: string;
  }
>;

export interface ClaimDueOptions {
  readonly leaseForMs: number;
  readonly limit: number;
  readonly now: Date;
}

interface ScheduleStoreDeps {
  readonly db: Db;
}

type LibsqlClient = Db["$client"];
type LibsqlBatchEntry = Parameters<LibsqlClient["batch"]>[0][number];
type LibsqlStatement = Extract<LibsqlBatchEntry, { readonly sql: string }>;
type LibsqlResult = Awaited<ReturnType<LibsqlClient["execute"]>>;
type LibsqlRow = LibsqlResult["rows"][number];

export type ScheduleStoreError = InvalidInput | InvariantViolated | Transient;

const VIEW_COLUMNS = `
  id,
  channel_id AS "channelId",
  description,
  action_type AS "actionType",
  prompt,
  schedule_type AS "scheduleType",
  cron,
  timezone,
  status,
  next_run_at AS "nextRunAt",
  last_error AS "lastError",
  last_dispatched_at AS "lastDispatchedAt",
  fire_count AS "fireCount",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function inputError(subject: string, issue: string): InvalidInput {
  return new InvalidInput({ subject, issues: [issue] });
}

function invalidRow(field: string, detail: string): InvariantViolated {
  return new InvariantViolated({
    invariant: "libSQL scheduled task rows match the Drizzle schema",
    detail: `${field}: ${detail}`,
  });
}

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isLibsqlNull<T>(value: T | null): value is null {
  return value === null;
}

/** libSQL models SQL NULL as `null`; `undefined` is not a bindable `InValue`. */
// oxlint-disable-next-line unicorn/no-null -- sole SQL NULL bind argument in this module
const SQL_NULL = null;

function generatedString(
  generate: () => string,
  invariant: string,
): Result<string, InvariantViolated> {
  return Result.try({
    try: generate,
    catch: (cause) => new InvariantViolated({ invariant, detail: causeDetail(cause) }),
  });
}

function iso(date: Date, subject: string): Result<string, InvalidInput> {
  if (!Number.isFinite(date.getTime())) {
    return Result.err(inputError(subject, "expected a valid date"));
  }
  return Result.ok(date.toISOString());
}

function execute(
  client: LibsqlClient,
  operation: string,
  statement: LibsqlStatement,
): Promise<Result<LibsqlResult, Transient>> {
  return Result.tryPromise({
    try: () => client.execute(statement),
    catch: (cause) => new Transient({ operation, detail: causeDetail(cause) }),
  });
}

const actionTypeSchema = z.enum([AGENT, MESSAGE]) satisfies z.ZodType<
  ScheduledTaskRow["actionType"]
>;
const statusSchema = z.enum([ACTIVE, CANCELLED, COMPLETED, FAILED]) satisfies z.ZodType<
  ScheduledTaskRow["status"]
>;
const nonNegativeIntegerSchema = z.int().nonnegative();
const nullableStringSchema = z.string().nullable();
/** Written only by `createTask`, from `crypto.randomUUID()`. */
const taskIdSchema = z.uuid();
/** Written only by `iso()`, from `Date.prototype.toISOString`. */
const anchorSchema = z.iso.datetime();

/**
 * `scheduled_tasks_shape_check` in the durable schema already forbids the two
 * mismatched combinations, so the discriminated union restates the SQL CHECK
 * rather than adding a rule: `once` carries neither cron nor timezone,
 * `recurring` carries both.
 */
const onceShape = {
  scheduleType: z.literal(ONCE),
  cron: z.null(),
  timezone: z.null(),
};
const recurringShape = {
  scheduleType: z.literal(RECURRING),
  cron: z.string(),
  timezone: z.string(),
};

/**
 * Elements stay bare strings. The column is documented as an advisory
 * creation-time snapshot, and a claim batch aborts on the first undecodable
 * row, so a stricter element format would let one odd row stall the dispatcher.
 */
const memberRolesJsonSchema = jsonCodec(z.array(z.string()));

const taskViewBaseShape = {
  id: taskIdSchema,
  channelId: discordSnowflake,
  description: z.string(),
  actionType: actionTypeSchema,
  prompt: z.string(),
  status: statusSchema,
  nextRunAt: anchorSchema,
  lastError: nullableStringSchema,
  lastDispatchedAt: nullableStringSchema,
  fireCount: nonNegativeIntegerSchema,
  // `created_at`/`updated_at` default to SQL `CURRENT_TIMESTAMP`, which is not
  // ISO 8601, so these stay plain strings even though our writer always is.
  createdAt: z.string(),
  updatedAt: z.string(),
};

const taskViewRowSchema = z
  .discriminatedUnion("scheduleType", [
    z.strictObject({ ...taskViewBaseShape, ...onceShape }),
    z.strictObject({ ...taskViewBaseShape, ...recurringShape }),
  ])
  .transform(({ cron, timezone, lastError, lastDispatchedAt, ...view }) => ({
    ...view,
    ...(isLibsqlNull(cron) ? {} : { cron }),
    ...(isLibsqlNull(timezone) ? {} : { timezone }),
    ...(isLibsqlNull(lastError) ? {} : { lastError }),
    ...(isLibsqlNull(lastDispatchedAt) ? {} : { lastDispatchedAt }),
  })) satisfies z.ZodType<ScheduledTaskView>;

const claimedBaseShape = {
  id: taskIdSchema,
  ownerId: discordSnowflake,
  channelId: discordSnowflake,
  description: z.string(),
  actionType: actionTypeSchema,
  prompt: z.string(),
  memberRoles: memberRolesJsonSchema.nullable(),
  nextRunAt: anchorSchema,
  leaseToken: z.uuid(),
  attemptCount: nonNegativeIntegerSchema,
};

const claimedScheduleRowSchema = z
  .discriminatedUnion("scheduleType", [
    z.strictObject({ ...claimedBaseShape, ...onceShape }),
    z.strictObject({ ...claimedBaseShape, ...recurringShape }),
  ])
  .transform(({ cron, timezone, memberRoles, ...claim }) => ({
    ...claim,
    ...(isLibsqlNull(cron) ? {} : { cron }),
    ...(isLibsqlNull(timezone) ? {} : { timezone }),
    ...(isLibsqlNull(memberRoles) ? {} : { memberRoles }),
    occurrenceId: scheduleOccurrenceId(claim.id, claim.nextRunAt),
  })) satisfies z.ZodType<ClaimedSchedule>;

function malformedRow(error: z.ZodError): InvariantViolated {
  const issue = error.issues[0];
  const field = issue?.path[0];
  return invalidRow(field === undefined ? "row" : String(field), issue?.message ?? "invalid row");
}

function decodeRow<S extends z.ZodType>(
  schema: S,
  row: LibsqlRow,
): Result<z.output<S>, InvariantViolated> {
  const decoded = schema.safeParse(row);
  return decoded.success ? Result.ok(decoded.data) : Result.err(malformedRow(decoded.error));
}

function taskView(row: LibsqlRow): Result<ScheduledTaskView, InvariantViolated> {
  return decodeRow(taskViewRowSchema, row);
}

function recurringNextRun(cron: string, timezone: string, after: Date): Result<Date, InvalidInput> {
  if (cron.trim().split(/\s+/u).length !== 5) {
    return Result.err(inputError("recurring schedule", "cron must contain exactly five fields"));
  }
  if (cron.includes("?")) {
    return Result.err(
      inputError("recurring schedule", "cron cannot use the initialization-relative ? placeholder"),
    );
  }

  const computed = Result.try({
    try: () => {
      const schedule = new Cron(cron, { paused: true, timezone });
      try {
        return schedule.nextRun(after);
      } finally {
        schedule.stop();
      }
    },
    catch: (cause) => inputError("recurring schedule", causeDetail(cause)),
  });
  if (Result.isError(computed)) return computed;
  const next = computed.value ?? undefined;
  return next === undefined
    ? Result.err(inputError("recurring schedule", "cron has no future occurrence"))
    : Result.ok(next);
}

/** Stable across every retry of the same anchored occurrence. */
function scheduleOccurrenceId(taskId: string, nextRunAt: string): string {
  return createHash("sha256")
    .update(taskId)
    .update("\0")
    .update(nextRunAt)
    .digest("base64url")
    .slice(0, 22);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_CHARS);
}

function retryAt(now: Date, nextAttemptCount: number): Date {
  const delayMinutes = Math.min(30, 2 ** (nextAttemptCount - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

function claimedFromRow(row: LibsqlRow): Result<ClaimedSchedule, InvariantViolated> {
  return decodeRow(claimedScheduleRowSchema, row);
}

async function createTask(
  client: LibsqlClient,
  owner: ScheduleOwner,
  input: CreateScheduleInput,
  createdAt: Date,
  newId: () => string,
): Promise<Result<ScheduledTaskView, ScheduleStoreError>> {
  return Result.gen(async function* () {
    const nextRun =
      input.type === ONCE
        ? input.runAt
        : yield* recurringNextRun(input.cron, input.timezone, createdAt);
    if (nextRun.getTime() <= createdAt.getTime()) {
      return Result.err(inputError("schedule", "the first run must be in the future"));
    }

    const timestamp = yield* iso(createdAt, "schedule creation time");
    const nextRunAt = yield* iso(nextRun, "schedule first run");
    const cron = input.type === RECURRING ? input.cron : SQL_NULL;
    const timezone = input.type === RECURRING ? input.timezone : SQL_NULL;
    const id = yield* generatedString(newId, "scheduled task IDs can be generated");
    const result = yield* Result.await(
      execute(client, "create scheduled task", {
        sql: `
          INSERT INTO scheduled_tasks (
            id, owner_id, channel_id, description, action_type, prompt, member_roles,
            schedule_type, cron, timezone, next_run_at, available_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING ${VIEW_COLUMNS}
        `,
        args: [
          id,
          owner.ownerId,
          owner.channelId,
          input.description,
          AGENT,
          input.prompt,
          // Encoded through the same codec that decodes it back at claim time.
          z.encode(memberRolesJsonSchema, owner.memberRoles ?? []),
          input.type,
          cron,
          timezone,
          nextRunAt,
          nextRunAt,
          timestamp,
          timestamp,
        ],
      }),
    );
    const row = result.rows[0];
    return row === undefined
      ? Result.err(invalidRow("insert", "scheduled task insert returned no row"))
      : taskView(row);
  });
}

async function listTasks(
  client: LibsqlClient,
  owner: ScheduleOwner,
): Promise<Result<readonly ScheduledTaskView[], ScheduleStoreError>> {
  return Result.gen(async function* () {
    const result = yield* Result.await(
      execute(client, "list scheduled tasks", {
        sql: `
          SELECT ${VIEW_COLUMNS}
          FROM scheduled_tasks
          WHERE owner_id = ?
          ORDER BY created_at DESC, id ASC
          LIMIT ?
        `,
        args: [owner.ownerId, MAX_LISTED_TASKS],
      }),
    );
    const tasks: ScheduledTaskView[] = [];
    for (const row of result.rows) tasks.push(yield* taskView(row));
    return Result.ok(tasks);
  });
}

async function cancelTask(
  client: LibsqlClient,
  owner: ScheduleOwner,
  id: string,
  at: Date,
): Promise<Result<boolean, InvalidInput | Transient>> {
  return Result.gen(async function* () {
    const timestamp = yield* iso(at, "schedule cancellation time");
    const result = yield* Result.await(
      execute(client, "cancel scheduled task", {
        sql: `
          UPDATE scheduled_tasks
          SET status = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND owner_id = ? AND status = ?
        `,
        args: [CANCELLED, timestamp, id, owner.ownerId, ACTIVE],
      }),
    );
    return Result.ok(result.rowsAffected === 1);
  });
}

async function claimDueTasks(
  client: LibsqlClient,
  options: ClaimDueOptions,
  newLeaseToken: () => string,
): Promise<Result<readonly ClaimedSchedule[], ScheduleStoreError>> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    return Result.err(inputError("schedule claim", "limit must be an integer from 1 through 100"));
  }
  if (!Number.isFinite(options.leaseForMs) || options.leaseForMs <= 0) {
    return Result.err(inputError("schedule claim", "lease duration must be positive"));
  }

  return Result.gen(async function* () {
    const leaseToken = yield* generatedString(
      newLeaseToken,
      "scheduled task lease tokens can be generated",
    );
    const claimedAt = yield* iso(options.now, "schedule claim time");
    const leaseExpiresAt = yield* iso(
      new Date(options.now.getTime() + options.leaseForMs),
      "schedule lease expiration",
    );
    const result = yield* Result.await(
      execute(client, "claim due scheduled tasks", {
        sql: `
          UPDATE scheduled_tasks
          SET lease_token = ?, lease_expires_at = ?, updated_at = ?
          WHERE id IN (
            SELECT id
            FROM scheduled_tasks
            WHERE status = ?
              AND available_at <= ?
              AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
            ORDER BY available_at ASC, id ASC
            LIMIT ?
          )
            AND status = ?
            AND available_at <= ?
            AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
          RETURNING
            id,
            owner_id AS "ownerId",
            channel_id AS "channelId",
            description,
            action_type AS "actionType",
            prompt,
            member_roles AS "memberRoles",
            schedule_type AS "scheduleType",
            cron,
            timezone,
            next_run_at AS "nextRunAt",
            lease_token AS "leaseToken",
            attempt_count AS "attemptCount"
        `,
        args: [
          leaseToken,
          leaseExpiresAt,
          claimedAt,
          ACTIVE,
          claimedAt,
          claimedAt,
          options.limit,
          ACTIVE,
          claimedAt,
          claimedAt,
        ],
      }),
    );
    const tasks: ClaimedSchedule[] = [];
    for (const row of result.rows) tasks.push(yield* claimedFromRow(row));
    return Result.ok(tasks);
  });
}

async function completeTask(
  client: LibsqlClient,
  job: ClaimedSchedule,
  dispatchedAt: Date,
): Promise<Result<boolean, ScheduleStoreError>> {
  return Result.gen(async function* () {
    const timestamp = yield* iso(dispatchedAt, "schedule dispatch time");
    if (job.scheduleType === ONCE) {
      const result = yield* Result.await(
        execute(client, "complete one-time scheduled task", {
          sql: `
            UPDATE scheduled_tasks
            SET status = ?, attempt_count = 0, last_error = NULL,
                last_dispatched_at = ?, lease_token = NULL, lease_expires_at = NULL,
                fire_count = fire_count + 1, updated_at = ?
            WHERE id = ? AND status = ? AND next_run_at = ? AND lease_token = ?
          `,
          args: [COMPLETED, timestamp, timestamp, job.id, ACTIVE, job.nextRunAt, job.leaseToken],
        }),
      );
      return Result.ok(result.rowsAffected === 1);
    }

    const cron = job.cron ?? undefined;
    const timezone = job.timezone ?? undefined;
    if (cron === undefined || timezone === undefined) {
      return Result.err(invalidRow("recurring schedule", "cron and timezone must both be present"));
    }
    const nextRun = yield* recurringNextRun(cron, timezone, new Date(job.nextRunAt));
    const nextRunAt = yield* iso(nextRun, "recurring schedule next run");
    const result = yield* Result.await(
      execute(client, "complete recurring scheduled task", {
        sql: `
          UPDATE scheduled_tasks
          SET next_run_at = ?, available_at = ?, attempt_count = 0, last_error = NULL,
              last_dispatched_at = ?, lease_token = NULL, lease_expires_at = NULL,
              fire_count = fire_count + 1, updated_at = ?
          WHERE id = ? AND status = ? AND next_run_at = ? AND lease_token = ?
        `,
        args: [
          nextRunAt,
          nextRunAt,
          timestamp,
          timestamp,
          job.id,
          ACTIVE,
          job.nextRunAt,
          job.leaseToken,
        ],
      }),
    );
    return Result.ok(result.rowsAffected === 1);
  });
}

export interface ScheduleFailureSettlement {
  readonly attemptCount: number;
  readonly settled: boolean;
  readonly terminal: boolean;
}

async function failTask(
  client: LibsqlClient,
  job: ClaimedSchedule,
  error: unknown,
  failedAt: Date,
): Promise<Result<ScheduleFailureSettlement, InvalidInput | Transient>> {
  return Result.gen(async function* () {
    const nextAttemptCount = job.attemptCount + 1;
    const terminal = nextAttemptCount >= SCHEDULE_MAX_ATTEMPTS;
    const timestamp = yield* iso(failedAt, "schedule failure time");
    const nextAvailableAt = terminal
      ? timestamp
      : yield* iso(retryAt(failedAt, nextAttemptCount), "schedule retry time");
    const result = yield* Result.await(
      execute(client, "settle failed scheduled task", {
        sql: `
          UPDATE scheduled_tasks
          SET attempt_count = ?, last_error = ?, status = ?, available_at = ?,
              lease_token = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND status = ? AND next_run_at = ? AND lease_token = ?
        `,
        args: [
          nextAttemptCount,
          errorMessage(error),
          terminal ? FAILED : ACTIVE,
          nextAvailableAt,
          timestamp,
          job.id,
          ACTIVE,
          job.nextRunAt,
          job.leaseToken,
        ],
      }),
    );
    const settled = result.rowsAffected === 1;
    return Result.ok({
      attemptCount: nextAttemptCount,
      settled,
      // A stale worker must not report a terminal transition it did not commit.
      terminal: settled && terminal,
    });
  });
}

function createScheduleStore(deps: ScheduleStoreDeps) {
  const client = deps.db.$client;
  const newId = () => crypto.randomUUID();
  const newLeaseToken = () => crypto.randomUUID();
  const now = () => new Date();

  return {
    create: (owner: ScheduleOwner, input: CreateScheduleInput) =>
      createTask(client, owner, input, now(), newId),
    list: (owner: ScheduleOwner) => listTasks(client, owner),
    cancel: (owner: ScheduleOwner, id: string) => cancelTask(client, owner, id, now()),
    claimDue: (options: ClaimDueOptions) => claimDueTasks(client, options, newLeaseToken),
    complete: (job: ClaimedSchedule, dispatchedAt = now()) =>
      completeTask(client, job, dispatchedAt),
    fail: (job: ClaimedSchedule, error: unknown, failedAt = now()) =>
      failTask(client, job, error, failedAt),
  };
}

export type ScheduleStore = ReturnType<typeof createScheduleStore>;

let defaultStore: Promise<ScheduleStore> | undefined;

/** Defers Drizzle/libSQL loading until execution; Eve evaluates authored modules at discovery. */
export function getScheduleStore(): Promise<ScheduleStore> {
  defaultStore ??= Promise.all([import("@repo/shared/db"), import("../../env.ts")]).then(
    ([{ getDb }, { tursoConfig }]) => createScheduleStore({ db: getDb(tursoConfig()) }),
  );
  return defaultStore;
}
