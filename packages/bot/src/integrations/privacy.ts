/**
 * Client for the Purdue Hackers privacy database at pdb.purduehackers.com.
 *
 * The service is the source of truth for whether a person's data may appear in
 * public Purdue Hackers projects, so this is the one integration where getting
 * the failure mode wrong has a privacy consequence rather than a UX one.
 *
 * Three changes from the prior client, each deliberate:
 *
 * - It returns `Result` instead of throwing a generic `Error("Privacy API
 *   request failed")`. The old shape made every failure indistinguishable, so
 *   the command could only ever say "something went wrong".
 * - Responses are validated. The old client cast `res.json()` straight to
 *   `UserPreferences`, so a changed payload would surface as `undefined`
 *   rendered into a Discord message rather than an error.
 * - A non-2xx maps to a typed error by status: 429 to `RateLimited`, 5xx to
 *   `Transient` (retryable), everything else to `UpstreamError`.
 */

import { RateLimited, Transient, UpstreamError } from "@repo/shared/errors";
import { InvalidInput } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";
import { z } from "zod";

const PRIVACY_DB_URL = "https://pdb.purduehackers.com";

export const PrivacyMode = {
  OptIn: "opt_in",
  OptOutPrivacy: "opt_out_privacy",
  /** Deletes data outright, rather than hiding it. Irreversible. */
  OptOutCollection: "opt_out_collection",
} as const;

export type PrivacyMode = (typeof PrivacyMode)[keyof typeof PrivacyMode];

export const PrivacyProject = {
  CommitOverflow: "commit-overflow",
  Ships: "ships",
} as const;

export type PrivacyProject = (typeof PrivacyProject)[keyof typeof PrivacyProject];

/**
 * Narrows an option value from Discord.
 *
 * Discord constrains the choices it will send, so a mismatch means our
 * registered command and this code disagree — deploy skew, not user input. It is
 * still validated rather than cast, because a cast would carry the bad value all
 * the way into a request body.
 */
export function isPrivacyMode(value: string): value is PrivacyMode {
  return Object.values(PrivacyMode).some((mode) => mode === value);
}

export function isPrivacyProject(value: string): value is PrivacyProject {
  return Object.values(PrivacyProject).some((project) => project === value);
}

export const MODE_LABELS: Record<PrivacyMode, string> = {
  [PrivacyMode.OptIn]: "Opt In (public)",
  [PrivacyMode.OptOutPrivacy]: "Opt Out (hidden, data kept)",
  [PrivacyMode.OptOutCollection]: "Opt Out (no data collected)",
};

export const PROJECT_LABELS: Record<PrivacyProject, string> = {
  [PrivacyProject.CommitOverflow]: "Commit Overflow",
  [PrivacyProject.Ships]: "Ships",
};

const modeSchema = z.enum(PrivacyMode);

const preferencesSchema = z.object({
  user_id: z.string(),
  mode: modeSchema,
  /** Unknown project keys are tolerated: the service may add one before we do. */
  overrides: z.record(z.string(), z.string()),
});

export type UserPreferences = z.output<typeof preferencesSchema>;

export type PrivacyError = InvalidInput | RateLimited | Transient | UpstreamError;

export interface PrivacyClientDeps {
  readonly apiKey: string;
}

/**
 * The only body the service is ever sent: every write is a mode change with an
 * optional reason. `reason` stays `string | undefined` rather than an optional
 * property, because the callers always pass the key and `JSON.stringify` is what
 * drops it when it is undefined.
 */
interface PreferenceUpdate {
  readonly mode: PrivacyMode;
  readonly reason: string | undefined;
}

function classify(status: number, detail: string): PrivacyError {
  if (status === 429) return new RateLimited({ service: "privacy-db", retryAfterMs: 1_000 });
  if (status >= 500) return new Transient({ operation: "privacy-db request", detail });
  return new UpstreamError({ service: "privacy-db", status, detail });
}

export function createPrivacyClient(deps: PrivacyClientDeps) {
  async function request(
    method: string,
    path: string,
    body?: PreferenceUpdate,
  ): Promise<Result<unknown, PrivacyError>> {
    return Result.tryPromise(
      {
        try: async () => {
          const response = await fetch(`${PRIVACY_DB_URL}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${deps.apiKey}`,
              "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });

          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw classify(response.status, detail.slice(0, 200));
          }

          // DELETE and PUT may answer with an empty body.
          const text = await response.text();
          return text === "" ? undefined : JSON.parse(text);
        },
        catch: (cause) =>
          // `classify` already produced a typed error; anything else is a
          // transport failure, which is retryable.
          cause instanceof RateLimited ||
          cause instanceof Transient ||
          cause instanceof UpstreamError
            ? cause
            : new Transient({
                operation: `privacy-db ${method} ${path}`,
                detail: cause instanceof Error ? cause.message : String(cause),
              }),
      },
      upstreamRetry,
    );
  }

  return {
    getPreferences: async (userId: string): Promise<Result<UserPreferences, PrivacyError>> => {
      const raw = await request("GET", `/preferences/${userId}`);
      if (Result.isError(raw)) return raw;

      const parsed = preferencesSchema.safeParse(raw.value);
      if (!parsed.success) {
        return Result.err(
          new InvalidInput({
            subject: "privacy-db preferences response",
            // The path, not just the message: "mode: invalid option" names the
            // field the service changed, which a bare message does not.
            issues: parsed.error.issues.map(({ message, path }) =>
              path.length === 0 ? message : `${path.join(".")}: ${message}`,
            ),
          }),
        );
      }
      return Result.ok(parsed.data);
    },

    setGlobalMode: async (
      userId: string,
      mode: PrivacyMode,
      reason?: string,
    ): Promise<Result<undefined, PrivacyError>> =>
      Result.map(await request("PUT", `/preferences/${userId}`, { mode, reason }), () => undefined),

    setProjectOverride: async (
      userId: string,
      project: PrivacyProject,
      mode: PrivacyMode,
      reason?: string,
    ): Promise<Result<undefined, PrivacyError>> =>
      Result.map(
        await request("PUT", `/preferences/${userId}/${project}`, { mode, reason }),
        () => undefined,
      ),

    resetPreferences: async (userId: string): Promise<Result<undefined, PrivacyError>> =>
      Result.map(await request("DELETE", `/preferences/${userId}`), () => undefined),

    removeProjectOverride: async (
      userId: string,
      project: PrivacyProject,
    ): Promise<Result<undefined, PrivacyError>> =>
      Result.map(await request("DELETE", `/preferences/${userId}/${project}`), () => undefined),
  };
}

export type PrivacyClient = ReturnType<typeof createPrivacyClient>;
