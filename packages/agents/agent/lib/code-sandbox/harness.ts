import { createHash, randomBytes } from "node:crypto";

import type { HarnessV1SandboxProvider } from "@ai-sdk/harness";
import { createCodex } from "@ai-sdk/harness-codex";
import {
  HarnessAgent,
  type HarnessAgentResumeSessionState,
  type HarnessAgentSession,
} from "@ai-sdk/harness/agent";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { TaggedError } from "@repo/shared/result";
import { APIError, Sandbox, type NetworkPolicy } from "@vercel/sandbox";
import type { DynamicToolCall } from "ai";
import { defineState } from "eve/context";
import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";
import { z } from "zod";

import { jsonCodec } from "../core/schema.ts";
import { assertStateValue } from "../core/serialization.ts";
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

/** The adapter binds its bridge to the sandbox's first declared port. */
const CODE_HARNESS_BRIDGE_PORT = 4_000;
const SANDBOX_TIMEOUT_MS = 45 * 60_000;
const BRIDGE_STARTUP_TIMEOUT_MS = 5 * 60_000;
const TASK_TIMEOUT_MS = 20 * 60_000;
const MAX_REPORTED_CHANGES = 200;
/** Tighter than the shared tool cap, because this text is one agent report. */
const MAX_SUMMARY_BYTES = Math.min(MAX_TOOL_TEXT_BYTES, 16_000);
/** Wide enough for SHA-256 object ids, which GitHub repositories may use. */
const commitSha = z.stringFormat("git-commit-sha", /^[a-f0-9]{40,64}$/u);

/**
 * Typed against `@vercel/sandbox` rather than Eve's sandbox contract: this
 * sandbox is provisioned by `@ai-sdk/sandbox-vercel`, not by Eve, and the two
 * policy shapes are only incidentally similar.
 *
 * Codex talks to the model from *inside* the sandbox, so unlike the Eve code
 * sandbox this one needs the gateway host as egress; the rest mirrors the
 * normal code-work allow list. Like `CODE_SANDBOX_NETWORK_POLICY` it carries no
 * subnet deny list: an allow list already refuses everything unnamed, so a deny
 * list only restated it while risking the CIDR validation that broke sandbox
 * creation once already.
 */
const CODE_HARNESS_NETWORK_POLICY: NetworkPolicy = {
  allow: [
    // Codex itself: the bridge installs `@openai/codex-sdk` and then talks to
    // the gateway from inside the sandbox.
    "ai-gateway.vercel.sh",
    "registry.npmjs.org",
    "*.npmjs.org",
    "github.com",
    "*.github.com",
    "githubusercontent.com",
    "*.githubusercontent.com",
    "registry.yarnpkg.com",
    "bun.sh",
    "*.bun.sh",
    "deno.land",
    "*.deno.land",
    "pypi.org",
    "*.pypi.org",
    "pythonhosted.org",
    "*.pythonhosted.org",
    "crates.io",
    "*.crates.io",
    "rubygems.org",
    "*.rubygems.org",
    "packagist.org",
    "*.packagist.org",
    "repo.maven.apache.org",
    "services.gradle.org",
  ],
};

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
      /** Absolute checkout path *inside the Codex sandbox*, not the Eve one. */
      readonly repoRoot: string;
      /** JSON text of the harness resume payload; see `resumeStateSchema`. */
      readonly resumeState: string;
      /**
       * Vercel sandbox name, which is what `HarnessV1NetworkSandboxSession.id`
       * carries. Publication reattaches the firewall through it.
       */
      readonly sandboxName: string;
      readonly sessionId: string;
    };

/**
 * One parked Codex sandbox per Eve session. Without this, every request-scoped
 * tool call would start a fresh sandbox and throw away the previous edits.
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
  /** Whether the sandbox is still alive and reusable by the next call. */
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

/** Repository this Eve session's Codex sandbox is already bound to, if any. */
export function codeHarnessBoundRepo(): string | undefined {
  const state = codeHarnessState.get();
  return state.phase === "parked" ? state.repo : undefined;
}

function repositoryDirectoryName(repo: string): string {
  return repo.slice(repo.indexOf("/") + 1);
}

/** Sandbox names are shared with Vercel, so keep them short, opaque, and unique. */
function mintSessionId(sessionKey: string): string {
  const stable = createHash("sha256").update(sessionKey).digest("hex").slice(0, 16);
  return `${stable}-${randomBytes(4).toString("hex")}`;
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

/** Ambient Vercel credentials, exactly like the sandbox the agent already runs. */
function createCodeHarnessSandboxProvider(): HarnessV1SandboxProvider {
  return createVercelSandbox({
    runtime: "node24",
    ports: [CODE_HARNESS_BRIDGE_PORT],
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT_MS,
    networkPolicy: CODE_HARNESS_NETWORK_POLICY,
  });
}

/**
 * Observes the Vercel sandbox name the harness picked.
 *
 * `HarnessAgentSession` keeps its network sandbox session private, and the
 * name is the only handle publication can later reattach the firewall through,
 * so the provider seam is where we read it. Nothing else is intercepted: both
 * methods delegate and return the provider's own session untouched.
 */
function observingSandboxProvider(
  delegate: HarnessV1SandboxProvider,
  observe: (sandboxName: string) => void,
): HarnessV1SandboxProvider {
  const resumeSession = delegate.resumeSession;
  return {
    ...delegate,
    createSession: async (options) => {
      const session = await delegate.createSession(options);
      observe(session.id);
      return session;
    },
    ...(resumeSession === undefined
      ? {}
      : {
          resumeSession: async (options: Parameters<typeof resumeSession>[0]) => {
            const session = await resumeSession(options);
            observe(session.id);
            return session;
          },
        }),
  };
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
      startupTimeoutMs: BRIDGE_STARTUP_TIMEOUT_MS,
    }),
    sandbox: input.sandbox,
    // Codex cannot emit approval requests for its own built-ins, so any other
    // mode makes `doStart` throw. The host gate is the Eve tool approval.
    permissionMode: "allow-all",
    instructions: `${INSTRUCTIONS} The repository is checked out at ./${directoryName}.`,
    sandboxConfig: {
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
        // A parked sandbox dies on its own timeout; a fresh one is the recovery.
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
 * Runs one Codex turn against a sandbox owned by this Eve session.
 *
 * On success the session is parked with `detach()` so the sandbox survives for
 * the next request-scoped tool call; on any failure it is destroyed, because a
 * sandbox nobody can resume is a running bill and a live checkout.
 */
export async function runCodeHarnessTask(input: {
  readonly abortSignal: AbortSignal;
  readonly ref: string | undefined;
  readonly repo: string;
  readonly sessionKey: string;
  readonly task: string;
}): Promise<CodeHarnessTaskResult> {
  const stored = codeHarnessState.get();
  const bound = stored.phase === "parked" && stored.repo === input.repo ? stored : undefined;
  let sandboxName: string | undefined;
  let checkout: CodeHarnessCheckout | undefined;
  const agent = createCodeHarnessAgent({
    onCheckout: (observed) => {
      checkout = observed;
    },
    ref: input.ref,
    repo: input.repo,
    sandbox: observingSandboxProvider(createCodeHarnessSandboxProvider(), (name) => {
      sandboxName = name;
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

  const deadline = AbortSignal.any([input.abortSignal, AbortSignal.timeout(TASK_TIMEOUT_MS)]);
  let parked = false;
  try {
    const observed = checkout;
    const name = sandboxName;
    // Both are set while the session opens. Checking before the turn runs means
    // a sandbox publication could never reattach to is torn down here rather
    // than left billing with a checkout nobody can reach.
    if (observed === undefined || name === undefined) {
      throw new Error("The Codex sandbox did not report its checkout.");
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
      // Deliberately not `z.encode(resumeStateSchema, resume)`: the sandbox is
      // already detached and `parked` is already set, so a validation throw here
      // would skip teardown and strand a live, billing sandbox. An unreadable
      // payload instead degrades to a fresh session at the next `openSession`.
      resumeState: JSON.stringify(resume),
      sandboxName: name,
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
      // Teardown must not mask the original failure that got us here.
      await opened.session.destroy().catch(() => undefined);
    }
  }
}

/**
 * The parked sandbox is gone, so the edits it held are unrecoverable.
 *
 * Separate from every other publication failure on purpose: an operator has to
 * be told the work is lost and must be redone, and publication must never
 * answer this by provisioning a fresh sandbox and pushing whatever is in it.
 */
export class CodeHarnessSandboxLost extends TaggedError("CodeHarnessSandboxLost")<{
  detail: string;
  message: string;
}> {
  constructor(detail: string) {
    super({
      detail,
      message: `the Codex sandbox holding these edits is gone (${detail}); the uncommitted work cannot be recovered and the task must be run again`,
    });
  }
}

/** The Sandbox API could not be reached, so the sandbox's fate is unknown. */
export class CodeHarnessSandboxUnreachable extends TaggedError("CodeHarnessSandboxUnreachable")<{
  detail: string;
  message: string;
}> {
  constructor(detail: string) {
    super({
      detail,
      message: `the Vercel Sandbox API could not be reached to republish from the Codex sandbox (${detail}); the edits may still be alive, so fix the configuration and retry rather than redoing the work`,
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
  /** Command surface only. Deliberately not the infra-capable session. */
  readonly exec: SandboxCommandRunner;
  /**
   * Firewall control, in the shape `withGitHubPushCredentials` brokers through.
   * It is a separate handle from `exec` so a command runner can never reach it.
   */
  readonly network: Pick<SandboxSession, "setNetworkPolicy">;
  /** The policy this sandbox normally runs under, restored after brokering. */
  readonly restorePolicy: SandboxNetworkPolicy;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? sanitizeText(cause.message, 500).text : "unknown error";
}

/**
 * Reattaches to the sandbox `code_task` parked, for publication only.
 *
 * Liveness is proven *before* reattaching, and with `resume: false`, so a
 * timed-out sandbox is reported as lost rather than silently restarted into an
 * empty checkout that would then be pushed as if it were the agent's work.
 *
 * The `network` handle drives the raw Vercel sandbox rather than the harness
 * session: `HarnessV1NetworkPolicy` can express host allow lists and CIDRs but
 * has no representation for a per-domain header transform, which is the entire
 * mechanism that keeps the installation token out of the sandbox.
 */
export async function attachParkedCodeHarnessSandbox(input: {
  readonly abortSignal: AbortSignal;
}): Promise<AttachedCodeHarnessSandbox> {
  const state = codeHarnessState.get();
  if (state.phase !== "parked") {
    throw new CodeHarnessSandboxLost("no Codex sandbox is parked for this session");
  }

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({
      name: state.sandboxName,
      resume: false,
      signal: input.abortSignal,
    });
  } catch (cause) {
    // A 404 is the sandbox itself being gone; anything else (most importantly
    // missing Vercel credentials) says nothing about whether it still exists.
    if (cause instanceof APIError && cause.response.status === 404) {
      throw new CodeHarnessSandboxLost("the sandbox no longer exists");
    }
    throw new CodeHarnessSandboxUnreachable(describe(cause));
  }
  if (sandbox.status !== "running") {
    throw new CodeHarnessSandboxLost(`the sandbox is ${sandbox.status}`);
  }

  const resumeSession = createCodeHarnessSandboxProvider().resumeSession;
  if (resumeSession === undefined) {
    throw new CodeHarnessSandboxUnreachable("the sandbox provider cannot reattach by session id");
  }
  let session: Awaited<ReturnType<typeof resumeSession>>;
  try {
    session = await resumeSession({
      sessionId: state.sessionId,
      abortSignal: input.abortSignal,
    });
  } catch (cause) {
    throw new CodeHarnessSandboxUnreachable(describe(cause));
  }
  // Identity check: the command surface and the firewall must govern the same
  // resource, or brokered credentials would be handed to the wrong sandbox.
  if (session.id !== state.sandboxName) {
    throw new CodeHarnessSandboxLost("the parked sandbox was replaced by a different one");
  }

  return {
    checkoutSha: state.checkoutSha,
    exec: session,
    network: {
      setNetworkPolicy: async (policy) => {
        // No abort signal: the restore leg has to run even once the caller's
        // signal is aborted, or an abort mid-push would strand the credential.
        await sandbox.update({ networkPolicy: policy });
      },
    },
    repo: state.repo,
    repoRoot: state.repoRoot,
    restorePolicy: CODE_HARNESS_NETWORK_POLICY,
  };
}
