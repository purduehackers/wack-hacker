import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { assertToolOutput } from "../serialization.ts";
import { artifactBytes, artifactForScope, artifactScope, saveArtifact } from "./store.ts";

export const datasetSchema = z.strictObject({
  source: z.string(),
  fetchedAt: z.iso.datetime(),
  complete: z.boolean(),
  data: z.json(),
});

export async function saveDataset(
  ctx: ToolContext,
  data: unknown,
  source: string,
  complete: boolean,
) {
  const value = {
    source,
    fetchedAt: new Date().toISOString(),
    complete,
    data: assertToolOutput(data),
  };
  return saveArtifact(artifactScope(ctx), {
    key: ctx.callId,
    kind: "dataset",
    filename: "dataset.json",
    mediaType: "application/json",
    body: Buffer.from(JSON.stringify(value)),
    metadata: { source, complete },
  });
}

/** A path like pages.*.data.edges.*.node flattens only explicit array wildcards. */
export function selectDatasetRows(
  value: z.output<ReturnType<typeof z.json>>,
  path: string,
): z.output<ReturnType<typeof z.json>>[] {
  let candidates = [value];
  for (const part of path.split(".").filter(Boolean)) {
    candidates = candidates.flatMap((entry) => {
      if (part === "*") {
        if (!Array.isArray(entry)) throw new Error("Dataset wildcard expected an array");
        return entry;
      }
      const object = z.record(z.string(), z.json()).parse(entry);
      const child = object[part];
      if (child === undefined) throw new Error(`Dataset path does not contain ${part}`);
      return [child];
    });
  }
  return candidates.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

export async function readDataset(ctx: ToolContext, id: string) {
  const artifact = await artifactForScope(id, artifactScope(ctx));
  if (artifact.kind !== "dataset") throw new Error("Expected a dataset artifact");
  return datasetSchema.parse(JSON.parse((await artifactBytes(artifact)).toString()));
}
