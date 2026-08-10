import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, secretName, selectedRepositoryIds, visibilityField } from "../../constants.ts";
import { encryptSecret } from "../../secret-encryption.ts";

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
