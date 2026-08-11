import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { guardToolExecution } from "../../../lib/serialization.ts";
import { codeHarnessBoundRepo, runCodeHarnessTask } from "../lib/harness.ts";
import { codeMutationApproval, decideCodeCapability } from "../lib/policy.ts";
import { containsLikelySecret, sanitizeText } from "../lib/safety.ts";
import { codeWorkspaceState } from "../lib/state.ts";

/** The `<name>` half of a bound repository, as GitHub itself constrains it. */
const repositoryName = z.stringFormat(
  "github-repository-name",
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/u,
);
/** Only the one owner is reachable, so the owner is part of the type, not a check. */
const boundRepository = z.templateLiteral(["purduehackers/", repositoryName]);
const gitRef = z.stringFormat("git-ref", /^(?![-./])(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/u);

const codeTaskInput = z.strictObject({
  repo: boundRepository.describe("Repository as purduehackers/<name>."),
  ref: gitRef.optional().describe("Optional public branch or tag to check out."),
  task: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe("The complete instruction for the coding agent, including how to verify it."),
});

function failed(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

/**
 * Codex-backed replacement for the hand-rolled read/write/bash capabilities.
 *
 * Kept tool-shaped rather than subagent-shaped: an Eve subagent's `model` is
 * `string | LanguageModel`, and a harness is neither.
 */
export default defineDynamic({
  events: {
    "step.started": (_event, resolveContext) => {
      const workspace = codeWorkspaceState.get();
      // Publication is terminal for this delegated session.
      if (workspace.phase === "ready" && workspace.publication !== undefined) return undefined;

      const policy = decideCodeCapability(
        resolveContext.session.auth.current,
        "code_task",
        "write",
      );
      if (!policy.allowed) return undefined;

      return defineTool({
        description:
          "Delegate one bounded coding task on a public purduehackers/<repo> to a Codex agent running in this session's sandbox. It checks the repository out, edits it, and runs the repository's own checks; it never commits, pushes, or opens a pull request. Later calls reuse the same sandbox, so they build on earlier edits. Returns the changed paths and the agent's own report. Requires current-admin approval on every call. Publish the result with code_post_finish, which commits from that same sandbox.",
        inputSchema: codeTaskInput,
        approval: ({ session }) => codeMutationApproval(session.auth.current, "code_task", "write"),
        async execute({ repo, ref, task }, ctx) {
          return guardToolExecution(async () => {
            const permission = decideCodeCapability(ctx.session.auth.current, "code_task", "write");
            if (!permission.allowed) {
              return {
                ok: false as const,
                error: {
                  code: "policy_denied",
                  message: permission.reason ?? "Code capability denied.",
                },
              };
            }
            if (containsLikelySecret(task)) {
              return failed("secret_input", "Task text containing likely secrets is refused.");
            }
            const bound = codeHarnessBoundRepo();
            if (bound !== undefined && bound !== repo) {
              return failed(
                "workspace_already_bound",
                `This session's sandbox is already bound to ${bound}.`,
              );
            }

            try {
              const outcome = await runCodeHarnessTask({
                abortSignal: ctx.abortSignal,
                ref,
                repo,
                // Codex runs inside this sandbox rather than one of its own, so
                // its edits are visible to publication without a reattach.
                sandbox: await ctx.getSandbox(),
                sessionKey: ctx.session.id,
                task,
              });
              return { ok: true as const, repo, ...outcome };
            } catch (cause) {
              return failed(
                "harness_failed",
                cause instanceof Error
                  ? sanitizeText(cause.message, 2_000).text
                  : "The Codex session did not complete.",
              );
            }
          });
        },
      });
    },
  },
});
