import { hsalsa, secretbox } from "@noble/ciphers/salsa.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { u32, u8 } from "@noble/hashes/utils.js";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit, octokitStatus } from "./client.ts";
import { env } from "./config.ts";
import {
  repoField,
  repoPaginatedInputShape,
  paginationInputShape,
  resourceId,
} from "./constants.ts";

// NaCl "expand 32-byte k" sigma constant
const SIGMA = new Uint32Array([1_634_760_805, 857_760_878, 2_036_477_234, 1_797_285_236]);
const ZEROS = new Uint32Array(4);

/**
 * Names Actions accepts for a secret or a variable: alphanumerics and
 * underscores, never leading with a digit.
 */
const actionsName = z.stringFormat("github-actions-name", /^[A-Za-z_][A-Za-z0-9_]*$/u);
const secretName = actionsName.describe("Secret name");
const variableName = actionsName.describe("Variable name");
const visibilityField = z
  .enum(["all", "private", "selected"])
  .describe("Repository visibility scope");
const selectedRepositoryIds = z
  .array(resourceId)
  .exactOptional()
  .describe("Repo IDs (required when visibility is 'selected')");

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
  const recipientPub = Uint8Array.from(atob(publicKeyBase64), (c) => c.charCodeAt(0));
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

export const list_repo_secrets = defineTool({
  description: `List Actions secrets for a repository. Returns secret names and timestamps only — values are never readable.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.actions.listRepoSecrets({
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

export const create_or_update_repo_secret = defineTool({
  description: `Create or update an Actions secret for a repository. The value is encrypted before storage.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    secret_name: secretName,
    value: z.string().describe("Secret value (will be encrypted)"),
  }),
  execute: async ({ repo, secret_name, value }) => {
    const { data: keyData } = await octokit().rest.actions.getRepoPublicKey({
      owner: env.GITHUB_ORG,
      repo,
    });
    const encrypted = encryptSecret(value, keyData.key);
    await octokit().rest.actions.createOrUpdateRepoSecret({
      owner: env.GITHUB_ORG,
      repo,
      secret_name,
      encrypted_value: encrypted,
      key_id: keyData.key_id,
    });
    return JSON.stringify({ created_or_updated: true, secret_name });
  },
});

export const delete_repo_secret = defineTool({
  description: `Delete an Actions secret from a repository.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    secret_name: secretName,
  }),
  execute: async ({ repo, secret_name }) => {
    await octokit().rest.actions.deleteRepoSecret({
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

export const list_repo_variables = defineTool({
  description: `List Actions variables for a repository. Unlike secrets, variable values are readable.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.actions.listRepoVariables({
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

export const create_or_update_repo_variable = defineTool({
  description: `Create or update an Actions variable for a repository. Updates if it exists, creates if it doesn't.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    name: variableName,
    value: z.string().describe("Variable value"),
  }),
  execute: async ({ repo, name, value }) => {
    try {
      await octokit().rest.actions.updateRepoVariable({
        owner: env.GITHUB_ORG,
        repo,
        name,
        value,
      });
    } catch (e: unknown) {
      if (octokitStatus(e) === 404) {
        await octokit().rest.actions.createRepoVariable({
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

export const delete_repo_variable = defineTool({
  description: `Delete an Actions variable from a repository.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    name: variableName,
  }),
  execute: async ({ repo, name }) => {
    await octokit().rest.actions.deleteRepoVariable({
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

export const list_org_secrets = defineTool({
  description: `List Actions secrets for the purduehackers organization. Returns names, timestamps, and visibility scope. Values are never readable.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.actions.listOrgSecrets({
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

export const create_or_update_org_secret = defineTool({
  description: `Create or update an Actions secret for the organization. Value is encrypted. Set visibility to control repo access ('all', 'private', or 'selected' with repo IDs).`,
  access: { risk: "destructive" },
  input: z.strictObject({
    secret_name: secretName,
    value: z.string().describe("Secret value (will be encrypted)"),
    visibility: visibilityField,
    selected_repository_ids: selectedRepositoryIds,
  }),
  execute: async ({ value, ...fields }) => {
    const { data: keyData } = await octokit().rest.actions.getOrgPublicKey({
      org: env.GITHUB_ORG,
    });
    const encrypted = encryptSecret(value, keyData.key);
    await octokit().rest.actions.createOrUpdateOrgSecret({
      org: env.GITHUB_ORG,
      encrypted_value: encrypted,
      key_id: keyData.key_id,
      ...fields,
    });
    return JSON.stringify({ created_or_updated: true, secret_name: fields.secret_name });
  },
});

export const delete_org_secret = defineTool({
  description: `Delete an Actions secret from the organization.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    secret_name: secretName,
  }),
  execute: async ({ secret_name }) => {
    await octokit().rest.actions.deleteOrgSecret({
      org: env.GITHUB_ORG,
      secret_name,
    });
    return JSON.stringify({ deleted: true, secret_name });
  },
});

// ---------------------------------------------------------------------------
// Organization Variables
// ---------------------------------------------------------------------------

export const list_org_variables = defineTool({
  description: `List Actions variables for the purduehackers organization. Returns name, value, timestamps, and visibility scope.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.actions.listOrgVariables({
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

export const create_or_update_org_variable = defineTool({
  description: `Create or update an Actions variable for the organization. Updates if it exists, creates if it doesn't. Set visibility to control repo access.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    name: variableName,
    value: z.string().describe("Variable value"),
    visibility: visibilityField,
    selected_repository_ids: selectedRepositoryIds,
  }),
  execute: async (input) => {
    try {
      await octokit().rest.actions.updateOrgVariable({
        org: env.GITHUB_ORG,
        ...input,
      });
    } catch (e: unknown) {
      if (octokitStatus(e) === 404) {
        await octokit().rest.actions.createOrgVariable({
          org: env.GITHUB_ORG,
          ...input,
        });
      } else throw e;
    }
    return JSON.stringify({ created_or_updated: true, name: input.name });
  },
});

export const delete_org_variable = defineTool({
  description: `Delete an Actions variable from the organization.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    name: variableName,
  }),
  execute: async ({ name }) => {
    await octokit().rest.actions.deleteOrgVariable({ org: env.GITHUB_ORG, name });
    return JSON.stringify({ deleted: true, name });
  },
});
