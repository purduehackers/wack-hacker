import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, workflowRef } from "../../constants.ts";

export const trigger_workflow = defineTool({
  description: `Trigger a workflow_dispatch event to manually run a workflow. The workflow must have a workflow_dispatch trigger defined. Specify the branch/tag to run on and optional input parameters.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    workflow_id: workflowRef.describe("Workflow ID or filename (e.g. 'deploy.yml')"),
    ref: z.string().describe("Branch or tag to run the workflow on"),
    inputs: z.record(z.string(), z.string()).exactOptional().describe("Workflow input parameters"),
  }),
  execute: async ({ repo, ...fields }) => {
    await octokit().rest.actions.createWorkflowDispatch({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ triggered: true, workflow_id: fields.workflow_id, ref: fields.ref });
  },
});
