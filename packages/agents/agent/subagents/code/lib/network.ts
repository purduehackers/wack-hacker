import type { InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";

/**
 * Egress the code sandbox runs under: unrestricted.
 *
 * It previously carried a package-registry allow list, which only ever
 * described the registries someone had thought of: a task needing a private
 * mirror, a git dependency, an unlisted docs host, or a language toolchain
 * nobody had used yet failed for reasons that looked like a broken repository
 * rather than a firewall. The sandbox holds no credential — the GitHub token is
 * injected at the firewall and never enters the process — and every mutation
 * still needs admin approval before it leaves. The allow list bought little and
 * cost real work.
 *
 * What remains below is not a restriction — it is the opposite.
 * `withGitHubPushCredentials` narrows egress *only* for the duration of a push,
 * so the firewall can attach the installation token to github.com requests
 * without the token ever existing inside a sandbox that runs model-written code.
 *
 * `sandbox.ts` declares this on the backend, so it is the policy every session
 * starts under and the one restored after a push.
 */
export const CODE_SANDBOX_NETWORK_POLICY: SandboxNetworkPolicy = "allow-all";

/**
 * The installation token exists only in the agent runtime and Vercel firewall
 * transform. Git receives an injected Basic header but cannot read the value.
 */
function githubPushNetworkPolicy(
  token: InstallationAccessTokenAuthentication["token"],
): SandboxNetworkPolicy {
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")}`;
  return {
    allow: {
      "github.com": [{ transform: [{ headers: { authorization } }] }],
      // Everything else stays reachable: this policy exists to attach a header,
      // not to fence the sandbox in while a push runs.
      "*": [],
    },
  };
}

type NetworkPolicySession = Pick<SandboxSession, "setNetworkPolicy">;

/**
 * Always removes the credential-bearing firewall rule, including on failure.
 *
 * There is one policy to restore because there is one sandbox. This used to
 * take the policy as a parameter, back when Codex ran in a second sandbox whose
 * egress was not the Eve sandbox's and restoring the wrong one would have cut
 * it off from hosts it legitimately needed.
 */
export async function withGitHubPushCredentials<T>(
  sandbox: NetworkPolicySession,
  token: InstallationAccessTokenAuthentication["token"],
  action: () => Promise<T>,
): Promise<T> {
  let outcome:
    | { readonly kind: "returned"; readonly value: T }
    | { readonly cause: unknown; readonly kind: "threw" };
  let restoration:
    | { readonly kind: "restored" }
    | { readonly cause: unknown; readonly kind: "failed" } = { kind: "restored" };
  try {
    // Applying the credential policy is inside the try so that a failure
    // *while* applying it still runs the restore below: a half-applied update
    // can leave the transform live at the firewall.
    await sandbox.setNetworkPolicy(githubPushNetworkPolicy(token));
    outcome = { kind: "returned", value: await action() };
  } catch (cause) {
    outcome = { kind: "threw", cause };
  } finally {
    try {
      await sandbox.setNetworkPolicy(CODE_SANDBOX_NETWORK_POLICY);
    } catch (cause) {
      restoration = { kind: "failed", cause };
      // A deny-all retry is safer than leaving a credential transform active.
      try {
        await sandbox.setNetworkPolicy("deny-all");
      } catch {
        // Preserve the restore failure; the installation token is short-lived
        // and repository-scoped, but callers must treat this as a hard failure.
      }
    }
  }
  if (restoration.kind === "failed") throw restoration.cause;
  if (outcome.kind === "threw") throw outcome.cause;
  return outcome.value;
}
