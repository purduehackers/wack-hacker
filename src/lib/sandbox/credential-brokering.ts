/**
 * GitHub credential brokering via Vercel Sandbox network policy.
 *
 * Instead of embedding tokens in git URLs or exposing them as env vars inside
 * the sandbox (where the agent could read or leak them), we tell the sandbox's
 * network layer to inject `Authorization` headers for GitHub hosts. The agent
 * runs stock `git push` / `gh pr create` / `curl api.github.com` and the
 * network policy transparently adds auth.
 *
 * Ported from open-agents (`packages/sandbox/vercel/sandbox.ts`).
 */

import type { NetworkPolicy } from "./types.ts";

const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  allow: {
    "*": [],
  },
};

/**
 * Build a network policy that transparently authenticates all outbound
 * GitHub traffic with `token`. Returns the permissive default when no token
 * is supplied (useful during snapshot builds before an installation token
 * has been minted).
 */
export function buildGitHubCredentialBrokeringPolicy(token?: string): NetworkPolicy {
  if (!token) return DEFAULT_NETWORK_POLICY;

  const basicAuthToken = Buffer.from(`x-access-token:${token}`, "utf-8").toString("base64");

  return {
    allow: {
      "api.github.com": [{ transform: [{ headers: { Authorization: `Bearer ${token}` } }] }],
      "uploads.github.com": [{ transform: [{ headers: { Authorization: `Bearer ${token}` } }] }],
      "codeload.github.com": [{ transform: [{ headers: { Authorization: `Bearer ${token}` } }] }],
      "github.com": [{ transform: [{ headers: { Authorization: `Basic ${basicAuthToken}` } }] }],
      "*": [],
    },
  };
}
