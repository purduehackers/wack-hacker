import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, secretName } from "../../constants.ts";
import { encryptSecret } from "../../secret-encryption.ts";

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
