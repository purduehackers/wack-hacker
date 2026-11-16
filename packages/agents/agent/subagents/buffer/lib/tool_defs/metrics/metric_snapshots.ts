import { z } from "zod";

import { saveDataset } from "../../../../../lib/artifacts/datasets.ts";
import { defineDomainTool } from "../../../../../lib/policy/domain-tools.ts";
import { readBufferSnapshots } from "../../snapshots.ts";

export const metric_snapshots = defineDomainTool({
  description:
    "Read Wack Hacker's stored daily Buffer observations. History starts only when the optional collector is enabled. Current cumulative post metrics are not daily accrued engagement or account follower totals. No snapshots means no observed history. Returns an authorized chart dataset when requested; rowsPath snapshots.*.posts.*.",
  access: { risk: "read", minRole: "organizer" },
  requires: ["BUFFER_ORGANIZATION_IDS"],
  input: z.strictObject({
    organizationId: z.string().min(1),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    limit: z.int().min(1).max(90).default(30),
    exportDataset: z.boolean().default(false),
  }),
  execute: async (input, ctx) => {
    const result = await readBufferSnapshots(
      input.organizationId,
      input.from,
      input.to,
      input.limit,
    );
    if (!input.exportDataset) return result;
    const dataset = await saveDataset(ctx, result, "Buffer daily observations", result.complete);
    return { ...result, datasetId: dataset.id };
  },
});
