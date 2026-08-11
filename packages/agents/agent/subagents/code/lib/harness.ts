import { createHash } from "node:crypto";

import type { HarnessV1SandboxProvider } from "@ai-sdk/harness";
import { createCodex } from "@ai-sdk/harness-codex";
import {
  HarnessAgent,
  type HarnessAgentResumeSessionState,
  type HarnessAgentSession,
} from "@ai-sdk/harness/agent";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { TaggedError } from "@repo/shared/result";
import { Sandbox } from "@vercel/sandbox";
import type { DynamicToolCall } from "ai";
import { defineState } from "eve/context";
import type { SandboxSession } from "eve/sandbox";
import { z } from "zod";

import { jsonCodec } from "../../../lib/schema.ts";
import { assertStateValue } from "../../../lib/serialization.ts";
import {
  CODE_BRIDGE_STARTUP_TIMEOUT_MS,
  CODE_SANDBOX_BRIDGE_PORT,
  CODE_TASK_TIMEOUT_MS,
} from "./constants.ts";
import {
  MAX_TOOL_TEXT_BYTES,
  sanitizeText,
  shellQuote,
  type SandboxCommandRunner,
} from "./safety.ts";

/**
 * `gpt-5.6-luna` through the AI Gateway. The adapter resolves the credential
 * ambiently from `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`, so no gateway
 * secret is declared in `agent/env.ts` or forwarded into the sandbox by us.
 */
const CODE_HARNESS_MODEL = "openai/gpt-5.6-luna";

const MAX_REPORTED_CHANGES = 200;
/** Tighter than the shared tool cap, because this text is one agent report. */
const MAX_SUMMARY_BYTES = Math.min(MAX_TOOL_TEXT_BYTES, 16_000);
/** Wide enough for SHA-256 object ids, which GitHub repositories may use. */
const commitSha = z.stringFormat("git-commit-sha", /^[a-f0-9]{40,64}$/u);

const INSTRUCTIONS = [
  "You are the code executor for a Purdue Hackers admin. You work only inside this sandbox.",
  "The requested repository is already cloned for you; do not clone or fetch another one.",
  "Make the smallest change that satisfies the request, and run the repository's own",
  "checks (its test/lint/typecheck scripts) before you report success.",
  "Never commit, never push, never open a pull request, and never touch git remotes or",
  "credentials: publication is a separate approved step owned by the host.",
  "Finish with a short report naming every file you changed and how you verified it.",
].join(" ");

/**
 * The parked payload is adapter-defined and opaque, so it is persisted as JSON
 * text and re-validated on the way back in. Storing the parsed object directly
 * would put an `@ai-sdk/provider` `JSONValue` (mutable arrays) into Eve's
 * read-only `JsonValue` state contract, which does not typecheck.
 */
const resumeStateSchema = jsonCodec(
  z.object({
    type: z.literal("resume-session"),
    harnessId: z.string().min(1),
    specificationVersion: z.literal("harness-v1"),
    data: z.json(),
  }),
);

export type CodeHarnessState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "parked";
      /**
       * Commit the sandbox originally cloned. Publication uses it as the
       * replay-safe no-change base and as the floor of the diff it scans, so it
       * is captured once and carried across resumes rather than re-read.
       */
      readonly checkoutSha: string;
      readonly repo: string;
      /** Absolute checkout path in this session's sandbox. */
      readonly repoRoot: string;
      /** JSON text of the harness resume payload; see `resumeStateSchema`. */
      readonly resumeState: string;
      readonly sessionId: string;
    };

/**
 * One parked Codex conversation per Eve session. The sandbox it ran in is the
 * session's own and outlives this record; what is parked here is the harness
 * transcript, so a later call continues rather than restarts.
 */
const codeHarnessState = defineState<CodeHarnessState>("wack.code.harness", () =>
  assertStateValue({ phase: "idle" }),
);

export interface CodeHarnessFileChange {
  readonly event: "create" | "delete" | "modify";
  readonly path: string;
}

export interface CodeHarnessTaskResult {
  readonly changed: readonly CodeHarnessFileChange[];
  readonly changesTruncated: boolean;
  readonly finishReason: string;
  /** Whether the conversation is resumable by the next call. */
  readonly parked: boolean;
  readonly redacted: boolean;
  readonly repoDirectory: string;
  readonly resumed: boolean;
  readonly summary: string;
  readonly truncated: boolean;
}

const fileChangeSchema = z.object({
  event: z.enum(["create", "delete", "modify"]),
  path: z.string().min(1),
});

/** Repository this Eve session's sandbox is already checked out to, if any. */
export function codeHarnessBoundRepo(): string | undefined {
  const state = codeHarnessState.get();
  return state.phase === "parked" ? state.repo : undefined;
}

function repositoryDirectoryName(repo: string): string {
  return repo.slice(repo.indexOf("/") + 1);
}

/** Harness session ids are opaque to Vercel now, but still stable per session. */
function mintSessionId(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 16);
}

function cloneCommand(repo: string, directory: string, ref: string | undefined): string {
  const origin = `https://github.com/${repo}.git`;
  const branch = ref === undefined ? "" : ` --branch ${shellQuote(ref)}`;
  // Idempotent because `onSession` also runs for resumed sessions.
  return [
    "set -eu",
    `if [ ! -d ${shellQuote(`${directory}/.git`)} ]; then`,
    // A private or missing repository otherwise blocks on a credential prompt
    // instead of failing, and the sandbox has no credentials by design.
    `  GIT_TERMINAL_PROMPT=0 git clone --depth 1${branch} -- ${shellQuote(origin)} ${shellQuote(directory)}`,
    "fi",
  ].join("\n");
}

/**
 * Hands Codex the sandbox Eve already provisioned for this session.
 *
 * `createVercelSandbox` has two modes: create one of its own, or wrap a
 * caller-provided `Sandbox`. The wrapping mode is the whole point — it marks
 * the session `ownsLifecycle: false`, so the adapter's `stop()` and `destroy()`
 * become no-ops and the harness cannot tear down a sandbox it does not own.
 *
 * Eve names its Vercel sandboxes after the session key and exposes that name as
 * `SandboxSession.id`, which is how a raw `Sandbox` handle is recovered here.
 * That correspondence is an implementation detail rather than a documented
 * contract, but it fails closed: a changed convention yields a 404 and a clear
 * error, never a handle to somebody else's sandbox.
 */
async function codeHarnessSandboxProvider(input: {
  readonly abortSignal: AbortSignal;
  readonly sandbox: SandboxSession;
}): Promise<HarnessV1SandboxProvider> {
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({
      name: input.sandbox.id,
      // Eve has already resumed the sandbox by the time `getSandbox()` returns,
      // so this is a lookup, not a second resume.
      resume: false,
      signal: input.abortSignal,
    });
  } catch (cause) {
    throw new CodeHarnessSandboxLost(
      `this session's sandbox could not be reached (${describe(cause)})`,
    );
  }
  return createVercelSandbox({ sandbox, bridgePorts: [CODE_SANDBOX_BRIDGE_PORT] });
}

/** What publication needs to know about the checkout Codex was handed. */
interface CodeHarnessCheckout {
  readonly checkoutSha: string;
  readonly repoRoot: string;
}

function createCodeHarnessAgent(input: {
  /** Called once per opened session, after the checkout is known to exist. */
  readonly onCheckout: (checkout: CodeHarnessCheckout) => void;
  readonly ref: string | undefined;
  readonly repo: string;
  readonly sandbox: HarnessV1SandboxProvider;
}): HarnessAgent<ReturnType<typeof createCodex>> {
  const directoryName = repositoryDirectoryName(input.repo);
  return new HarnessAgent({
    id: "code-harness",
    harness: createCodex({
      // Explicit gateway auth, not ambient fallthrough: with `auth` omitted the
      // adapter silently routes to the OpenAI API when no gateway key is in the
      // environment, which is the wrong endpoint for this deployment.
      auth: { gateway: {} },
      model: CODE_HARNESS_MODEL,
      // `xhigh` exists on the model but not in this adapter's typed union.
      reasoningEffort: "high",
      webSearch: false,
      startupTimeoutMs: CODE_BRIDGE_STARTUP_TIMEOUT_MS,
    }),
    sandbox: input.sandbox,
    // Codex cannot emit approval requests for its own built-ins, so any other
    // mode makes `doStart` throw. The host gate is the Eve tool approval.
    permissionMode: "allow-all",
    instructions: `${INSTRUCTIONS} The repository is checked out at ./${directoryName}.`,
    sandboxConfig: {
      // The clone stays here rather than in Eve's `onSession`: the repository is
      // an input to each `code_task` call, not a property of the session.
      onSession: async ({ session, sessionWorkDir, abortSignal }) => {
        const repoRoot = `${sessionWorkDir}/${directoryName}`;
        const signal = abortSignal === undefined ? {} : { abortSignal };
        const result = await session.run({
          command: cloneCommand(input.repo, repoRoot, input.ref),
          workingDirectory: sessionWorkDir,
          ...signal,
        });
        if (result.exitCode !== 0) {
          throw new Error(
            `Public checkout of ${input.repo} failed: ${sanitizeText(result.stderr, 2_000).text}`,
          );
        }
        const head = await session.run({
          command: `git -C ${shellQuote(repoRoot)} rev-parse HEAD`,
          workingDirectory: sessionWorkDir,
          ...signal,
        });
        const checkoutSha = head.stdout.trim();
        // Publication refuses to run without a verified base commit, so a
        // checkout we cannot name is a failed checkout.
        if (head.exitCode !== 0 || !commitSha.safeParse(checkoutSha).success) {
          throw new Error(`Checkout of ${input.repo} produced no verifiable HEAD commit.`);
        }
        input.onCheckout({ checkoutSha, repoRoot });
      },
    },
  });
}

async function openSession(
  agent: HarnessAgent<ReturnType<typeof createCodex>>,
  input: {
    readonly abortSignal: AbortSignal;
    readonly parked: { readonly resumeState: string; readonly sessionId: string } | undefined;
    readonly sessionKey: string;
  },
): Promise<{ readonly resumed: boolean; readonly session: HarnessAgentSession }> {
  if (input.parked !== undefined) {
    // The codec owns the `JSON.parse`: a corrupt payload becomes a failed parse
    // and a fresh session, where a bare `JSON.parse` here threw past the guard.
    const decoded = resumeStateSchema.safeParse(input.parked.resumeState);
    if (decoded.success) {
      try {
        const resumeFrom: HarnessAgentResumeSessionState = decoded.data;
        return {
          resumed: true,
          session: await agent.createSession({
            sessionId: input.parked.sessionId,
            resumeFrom,
            abortSignal: input.abortSignal,
          }),
        };
      } catch {
        // A transcript the adapter refuses is recoverable: the checkout is still
        // in the sandbox, so a fresh conversation resumes work on the same files.
        codeHarnessState.update(() => ({ phase: "idle" }));
      }
    }
  }
  return {
    resumed: false,
    session: await agent.createSession({
      sessionId: mintSessionId(input.sessionKey),
      abortSignal: input.abortSignal,
    }),
  };
}

function collectFileChanges(toolCalls: readonly DynamicToolCall[]): {
  readonly changes: CodeHarnessFileChange[];
  readonly truncated: boolean;
} {
  const seen = new Map<string, CodeHarnessFileChange>();
  for (const emitted of toolCalls) {
    if (emitted.toolName !== "fileChange") continue;
    const parsed = fileChangeSchema.safeParse(emitted.input);
    if (!parsed.success) continue;
    seen.set(parsed.data.path, { event: parsed.data.event, path: parsed.data.path });
  }
  const changes = [...seen.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    changes: changes.slice(0, MAX_REPORTED_CHANGES),
    truncated: changes.length > MAX_REPORTED_CHANGES,
  };
}

/**
 * Runs one Codex turn against this Eve session's sandbox.
 *
 * On success the conversation is parked with `detach()` so the next call
 * continues it. On failure the harness session is dropped, which now costs
 * nothing to recover from: the sandbox is Eve's, so the edits survive and only
 * the transcript is lost.
 */
export async function runCodeHarnessTask(input: {
  readonly abortSignal: AbortSignal;
  readonly ref: string | undefined;
  readonly repo: string;
  readonly sandbox: SandboxSession;
  readonly sessionKey: string;
  readonly task: string;
}): Promise<CodeHarnessTaskResult> {
  const stored = codeHarnessState.get();
  const bound = stored.phase === "parked" && stored.repo === input.repo ? stored : undefined;
  let checkout: CodeHarnessCheckout | undefined;
  const agent = createCodeHarnessAgent({
    onCheckout: (observed) => {
      checkout = observed;
    },
    ref: input.ref,
    repo: input.repo,
    sandbox: await codeHarnessSandboxProvider({
      abortSignal: input.abortSignal,
      sandbox: input.sandbox,
    }),
  });
  const opened = await openSession(agent, {
    abortSignal: input.abortSignal,
    parked:
      bound === undefined
        ? undefined
        : { resumeState: bound.resumeState, sessionId: bound.sessionId },
    sessionKey: input.sessionKey,
  });

  const deadline = AbortSignal.any([input.abortSignal, AbortSignal.timeout(CODE_TASK_TIMEOUT_MS)]);
  let parked = false;
  try {
    const observed = checkout;
    // Set while the session opens. Checking before the turn runs means a
    // checkout publication could never locate is reported here rather than
    // after a Codex turn has already edited files nobody can commit.
    if (observed === undefined) {
      throw new Error("The Codex session did not report its checkout.");
    }

    const result = await agent.generate({
      session: opened.session,
      prompt: input.task,
      abortSignal: deadline,
    });

    const resume = await opened.session.detach();
    parked = true;
    codeHarnessState.update(() => ({
      phase: "parked",
      // A resumed session keeps its original base commit: re-reading HEAD would
      // silently move the floor of the diff publication scans for secrets.
      checkoutSha: opened.resumed && bound !== undefined ? bound.checkoutSha : observed.checkoutSha,
      repo: input.repo,
      repoRoot: observed.repoRoot,
      // Deliberately not `z.encode(resumeStateSchema, resume)`: the session is
      // already detached and `parked` is already set, so a validation throw here
      // would skip teardown. An unreadable payload instead degrades to a fresh
      // conversation at the next `openSession`.
      resumeState: JSON.stringify(resume),
      sessionId: opened.session.sessionId,
    }));

    const summary = sanitizeText(result.text, MAX_SUMMARY_BYTES);
    const changes = collectFileChanges(result.dynamicToolCalls);
    return {
      changed: changes.changes,
      changesTruncated: changes.truncated,
      finishReason: result.finishReason,
      parked: true,
      redacted: summary.redacted,
      repoDirectory: `./${repositoryDirectoryName(input.repo)}`,
      resumed: opened.resumed,
      summary: summary.text,
      truncated: summary.truncated,
    };
  } finally {
    if (!parked) {
      codeHarnessState.update(() => ({ phase: "idle" }));
      // `destroy()` is a no-op on a caller-provided sandbox, so this releases
      // the harness session without touching the sandbox Eve owns.
      await opened.session.destroy().catch(() => undefined);
    }
  }
}

/**
 * The checkout is not where it was left, so the edits it held are unrecoverable.
 *
 * Separate from every other publication failure on purpose: an operator has to
 * be told the work is lost and must be redone, and publication must never
 * answer this by cloning a fresh checkout and pushing whatever is in it.
 *
 * Rarer than it used to be. This once covered a sandbox timing out on its own;
 * Eve resumes those. What is left is a sandbox Eve replaced — which it does
 * when the sandbox definition itself changes — landing the session on a fresh
 * filesystem with no checkout in it.
 */
export class CodeHarnessSandboxLost extends TaggedError("CodeHarnessSandboxLost")<{
  detail: string;
  message: string;
}> {
  constructor(detail: string) {
    super({
      detail,
      message: `the checkout holding these edits is gone (${detail}); the uncommitted work cannot be recovered and the task must be run again`,
    });
  }
}

export interface CodeHarnessPublicationTarget {
  readonly checkoutSha: string;
  readonly repo: string;
  readonly repoRoot: string;
}

/** The parked checkout publication would act on, if there is one. */
export function codeHarnessPublicationTarget(): CodeHarnessPublicationTarget | undefined {
  const state = codeHarnessState.get();
  if (state.phase !== "parked") return undefined;
  return { checkoutSha: state.checkoutSha, repo: state.repo, repoRoot: state.repoRoot };
}

export interface AttachedCodeHarnessSandbox extends CodeHarnessPublicationTarget {
  /** Command surface only. Deliberately not the policy-capable session. */
  readonly exec: SandboxCommandRunner;
  /**
   * Firewall control, in the shape `withGitHubPushCredentials` brokers through.
   * It is a separate handle from `exec` so a command runner can never reach it.
   */
  readonly network: Pick<SandboxSession, "setNetworkPolicy">;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? sanitizeText(cause.message, 500).text : "unknown error";
}

/**
 * Resolves the checkout `code_task` left, for publication only.
 *
 * The sandbox arrives from `ctx.getSandbox()` already alive, so nothing is
 * reattached here. What is still worth proving is that the checkout is *in* it:
 * Eve replaces a session's sandbox when the sandbox definition changes, and a
 * fresh filesystem would otherwise be committed as if it were the agent's work.
 */
export async function attachParkedCodeHarnessSandbox(input: {
  readonly abortSignal: AbortSignal;
  readonly sandbox: SandboxSession;
}): Promise<AttachedCodeHarnessSandbox> {
  const state = codeHarnessState.get();
  if (state.phase !== "parked") {
    throw new CodeHarnessSandboxLost("no checkout is parked for this session");
  }

  let probe: Awaited<ReturnType<SandboxSession["run"]>>;
  try {
    probe = await input.sandbox.run({
      command: `test -d ${shellQuote(`${state.repoRoot}/.git`)}`,
      abortSignal: input.abortSignal,
    });
  } catch (cause) {
    throw new CodeHarnessSandboxLost(`the sandbox could not be read (${describe(cause)})`);
  }
  if (probe.exitCode !== 0) {
    throw new CodeHarnessSandboxLost("the sandbox no longer holds the checkout");
  }

  return {
    checkoutSha: state.checkoutSha,
    exec: input.sandbox,
    network: { setNetworkPolicy: (policy) => input.sandbox.setNetworkPolicy(policy) },
    repo: state.repo,
    repoRoot: state.repoRoot,
  };
}
