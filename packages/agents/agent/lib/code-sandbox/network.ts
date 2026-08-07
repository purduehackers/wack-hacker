import type { InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";

const PRIVATE_AND_LINK_LOCAL_SUBNETS = [
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

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
  subnets: { deny: PRIVATE_AND_LINK_LOCAL_SUBNETS },
};

/**
 * The installation token exists only in the agent runtime and Vercel firewall
 * transform. Git receives an injected Basic header but cannot read the value.
 */
export function githubPushNetworkPolicy(
  token: InstallationAccessTokenAuthentication["token"],
): SandboxNetworkPolicy {
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")}`;
  return {
    allow: {
      "github.com": [{ transform: [{ headers: { authorization } }] }],
    },
    subnets: { deny: PRIVATE_AND_LINK_LOCAL_SUBNETS },
  };
}

type NetworkPolicySession = Pick<SandboxSession, "setNetworkPolicy">;

/** Always removes the credential-bearing firewall rule, including on failure. */
export async function withGitHubPushCredentials<T>(
  sandbox: NetworkPolicySession,
  token: InstallationAccessTokenAuthentication["token"],
  action: () => Promise<T>,
): Promise<T> {
  await sandbox.setNetworkPolicy(githubPushNetworkPolicy(token));
  let outcome:
    | { readonly kind: "returned"; readonly value: T }
    | { readonly cause: unknown; readonly kind: "threw" };
  let restoration:
    | { readonly kind: "restored" }
    | { readonly cause: unknown; readonly kind: "failed" } = { kind: "restored" };
  try {
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
