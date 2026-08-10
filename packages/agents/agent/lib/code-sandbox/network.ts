import type { InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";

/*
 * There is deliberately no subnet deny list.
 *
 * Both policies below are domain allowlists, so anything unnamed is already
 * refused — a private-range deny list only restated that. It also broke the
 * thing it was meant to protect: Vercel's sandbox create API rejects IPv6
 * CIDRs outright (`400 Invalid CIDR "::1/128"`), and eve forwards CIDRs
 * unvalidated, so every sandbox creation carrying this policy failed.
 */

/** Normal code-work egress. It never contains credentials. */
export const CODE_SANDBOX_NETWORK_POLICY: SandboxNetworkPolicy = {
  allow: [
    "github.com",
    "*.github.com",
    "githubusercontent.com",
    "*.githubusercontent.com",
    "registry.npmjs.org",
    "*.npmjs.org",
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
    },
  };
}

type NetworkPolicySession = Pick<SandboxSession, "setNetworkPolicy">;

/**
 * Always removes the credential-bearing firewall rule, including on failure.
 *
 * `restorePolicy` is the egress this sandbox normally runs under. It is a
 * parameter because the Codex sandbox's allow list is not the Eve sandbox's
 * one — restoring the wrong policy would silently cut the sandbox off from
 * hosts it legitimately needs.
 */
export async function withGitHubPushCredentials<T>(
  sandbox: NetworkPolicySession,
  token: InstallationAccessTokenAuthentication["token"],
  action: () => Promise<T>,
  restorePolicy: SandboxNetworkPolicy = CODE_SANDBOX_NETWORK_POLICY,
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
      await sandbox.setNetworkPolicy(restorePolicy);
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
