import { hsalsa, secretbox } from "@noble/ciphers/salsa.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { u32, u8 } from "@noble/hashes/utils.js";
import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../../env.ts";
import { octokit } from "../client";

// NaCl "expand 32-byte k" sigma constant
const SIGMA = new Uint32Array([1634760805, 857760878, 2036477234, 1797285236]);
const ZEROS = new Uint32Array(4);

/**
 * NaCl crypto_box_beforenm: derive a shared key from X25519 shared secret
 * by running it through HSalsa20.
 */
function boxBeforenm(sharedSecret: Uint8Array) {
  const output = new Uint32Array(8);
  hsalsa(SIGMA, u32(sharedSecret), ZEROS, output);
  return u8(output);
}

/**
 * NaCl crypto_box_seal: sealed box encryption for the GitHub secrets API.
 * Ephemeral X25519 keypair → HSalsa20 key derivation → XSalsa20-Poly1305.
 */
function encryptSecret(value: string, publicKeyBase64: string) {
  const recipientPub = Uint8Array.from(atob(publicKeyBase64), (c) =>
    c.charCodeAt(0),
  );
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // Derive encryption key: X25519 DH → HSalsa20
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, recipientPub);
  const key = boxBeforenm(sharedSecret);

  // Nonce = blake2b(ephemeralPub || recipientPub, 24 bytes)
  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeralPub, 0);
  nonceInput.set(recipientPub, 32);
  const nonce = blake2b(nonceInput, { dkLen: 24 });

  // Encrypt with XSalsa20-Poly1305 using the derived key
  const plaintext = new TextEncoder().encode(value);
  const ciphertext = secretbox(key, nonce).seal(plaintext);

  // Sealed box = ephemeralPub (32) || ciphertext
  const sealed = new Uint8Array(32 + ciphertext.length);
  sealed.set(ephemeralPub, 0);
  sealed.set(ciphertext, 32);

  return btoa(String.fromCharCode(...sealed));
}

// ---------------------------------------------------------------------------
// Repository Secrets
// ---------------------------------------------------------------------------

export const list_repo_secrets = tool({
  description: `List Actions secrets for a repository. Returns secret names and timestamps only — values are never readable.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit.rest.actions.listRepoSecrets({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      secrets: data.secrets.map((s) => ({
        name: s.name,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    });
  },
});

export const create_or_update_repo_secret = tool({
  description: `Create or update an Actions secret for a repository. The value is encrypted before storage.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    secret_name: z.string().describe("Secret name"),
    value: z.string().describe("Secret value (will be encrypted)"),
  }),
  execute: async ({ repo, secret_name, value }) => {
    const { data: keyData } = await octokit.rest.actions.getRepoPublicKey({
      owner: env.GITHUB_ORG,
      repo,
    });
    const encrypted = encryptSecret(value, keyData.key);
    await octokit.rest.actions.createOrUpdateRepoSecret({
      owner: env.GITHUB_ORG,
      repo,
      secret_name,
      encrypted_value: encrypted,
      key_id: keyData.key_id,
    });
    return JSON.stringify({ created_or_updated: true, secret_name });
  },
});

export const delete_repo_secret = tool({
  description: `Delete an Actions secret from a repository.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    secret_name: z.string().describe("Secret name"),
  }),
  execute: async ({ repo, secret_name }) => {
    await octokit.rest.actions.deleteRepoSecret({
      owner: env.GITHUB_ORG,
      repo,
      secret_name,
    });
    return JSON.stringify({ deleted: true, secret_name });
  },
});

// ---------------------------------------------------------------------------
// Repository Variables
// ---------------------------------------------------------------------------

export const list_repo_variables = tool({
  description: `List Actions variables for a repository. Unlike secrets, variable values are readable.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit.rest.actions.listRepoVariables({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      variables: data.variables.map((v) => ({
        name: v.name,
        value: v.value,
        created_at: v.created_at,
        updated_at: v.updated_at,
      })),
    });
  },
});

export const create_or_update_repo_variable = tool({
  description: `Create or update an Actions variable for a repository. Updates if it exists, creates if it doesn't.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    name: z.string().describe("Variable name"),
    value: z.string().describe("Variable value"),
  }),
  execute: async ({ repo, name, value }) => {
    try {
      await octokit.rest.actions.updateRepoVariable({
        owner: env.GITHUB_ORG,
        repo,
        name,
        value,
      });
    } catch (e: any) {
      if (e.status === 404) {
        await octokit.rest.actions.createRepoVariable({
          owner: env.GITHUB_ORG,
          repo,
          name,
          value,
        });
      } else throw e;
    }
    return JSON.stringify({ created_or_updated: true, name });
  },
});

export const delete_repo_variable = tool({
  description: `Delete an Actions variable from a repository.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    name: z.string().describe("Variable name"),
  }),
  execute: async ({ repo, name }) => {
    await octokit.rest.actions.deleteRepoVariable({
      owner: env.GITHUB_ORG,
      repo,
      name,
    });
    return JSON.stringify({ deleted: true, name });
  },
});

// ---------------------------------------------------------------------------
// Organization Secrets
// ---------------------------------------------------------------------------

export const list_org_secrets = tool({
  description: `List Actions secrets for the purduehackers organization. Returns names, timestamps, and visibility scope. Values are never readable.`,
  inputSchema: z.object({
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit.rest.actions.listOrgSecrets({
      org: env.GITHUB_ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      secrets: data.secrets.map((s) => ({
        name: s.name,
        created_at: s.created_at,
        updated_at: s.updated_at,
        visibility: s.visibility,
      })),
    });
  },
});

export const create_or_update_org_secret = tool({
  description: `Create or update an Actions secret for the organization. Value is encrypted. Set visibility to control repo access ('all', 'private', or 'selected' with repo IDs).`,
  inputSchema: z.object({
    secret_name: z.string().describe("Secret name"),
    value: z.string().describe("Secret value (will be encrypted)"),
    visibility: z
      .enum(["all", "private", "selected"])
      .describe("Repository visibility scope"),
    selected_repository_ids: z
      .array(z.number())
      .optional()
      .describe("Repo IDs (required when visibility is 'selected')"),
  }),
  execute: async ({
    secret_name,
    value,
    visibility,
    selected_repository_ids,
  }) => {
    const { data: keyData } = await octokit.rest.actions.getOrgPublicKey({
      org: env.GITHUB_ORG,
    });
    const encrypted = encryptSecret(value, keyData.key);
    await octokit.rest.actions.createOrUpdateOrgSecret({
      org: env.GITHUB_ORG,
      secret_name,
      encrypted_value: encrypted,
      key_id: keyData.key_id,
      visibility,
      selected_repository_ids,
    });
    return JSON.stringify({ created_or_updated: true, secret_name });
  },
});

export const delete_org_secret = tool({
  description: `Delete an Actions secret from the organization.`,
  inputSchema: z.object({
    secret_name: z.string().describe("Secret name"),
  }),
  execute: async ({ secret_name }) => {
    await octokit.rest.actions.deleteOrgSecret({
      org: env.GITHUB_ORG,
      secret_name,
    });
    return JSON.stringify({ deleted: true, secret_name });
  },
});

// ---------------------------------------------------------------------------
// Organization Variables
// ---------------------------------------------------------------------------

export const list_org_variables = tool({
  description: `List Actions variables for the purduehackers organization. Returns name, value, timestamps, and visibility scope.`,
  inputSchema: z.object({
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit.rest.actions.listOrgVariables({
      org: env.GITHUB_ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      variables: data.variables.map((v) => ({
        name: v.name,
        value: v.value,
        created_at: v.created_at,
        updated_at: v.updated_at,
        visibility: v.visibility,
      })),
    });
  },
});

export const create_or_update_org_variable = tool({
  description: `Create or update an Actions variable for the organization. Updates if it exists, creates if it doesn't. Set visibility to control repo access.`,
  inputSchema: z.object({
    name: z.string().describe("Variable name"),
    value: z.string().describe("Variable value"),
    visibility: z
      .enum(["all", "private", "selected"])
      .describe("Repository visibility scope"),
    selected_repository_ids: z.array(z.number()).optional(),
  }),
  execute: async ({ name, value, visibility, selected_repository_ids }) => {
    try {
      await octokit.rest.actions.updateOrgVariable({
        org: env.GITHUB_ORG,
        name,
        value,
        visibility,
        selected_repository_ids,
      });
    } catch (e: any) {
      if (e.status === 404) {
        await octokit.rest.actions.createOrgVariable({
          org: env.GITHUB_ORG,
          name,
          value,
          visibility,
          selected_repository_ids,
        });
      } else throw e;
    }
    return JSON.stringify({ created_or_updated: true, name });
  },
});

export const delete_org_variable = tool({
  description: `Delete an Actions variable from the organization.`,
  inputSchema: z.object({
    name: z.string().describe("Variable name"),
  }),
  execute: async ({ name }) => {
    await octokit.rest.actions.deleteOrgVariable({ org: env.GITHUB_ORG, name });
    return JSON.stringify({ deleted: true, name });
  },
});
