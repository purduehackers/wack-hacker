import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { readDataset, selectDatasetRows } from "../artifacts/datasets.ts";
import {
  artifactBytes,
  artifactForScope,
  artifactScope,
  attachArtifacts,
  saveArtifact,
} from "../artifacts/store.ts";
import { chartCsv } from "./data.ts";
import { renderChart } from "./render.ts";
import { chartInputSchema, chartSpecSchema } from "./spec.ts";

const rowsSchema = z.array(z.record(z.string(), z.json())).min(1).max(5000);
const savedChartSchema = z.strictObject({ spec: chartSpecSchema, rows: rowsSchema });

async function rowsForChart(input: z.output<typeof chartInputSchema>, ctx: ToolContext) {
  if (input.rows) return input.rows;
  if (input.datasetId) {
    const dataset = await readDataset(ctx, input.datasetId);
    if (!dataset.complete)
      throw new Error(
        "Dataset is incomplete; finish pagination or explicitly supply and label a partial table",
      );
    return rowsSchema.parse(selectDatasetRows(dataset.data, input.rowsPath));
  }
  const saved = await artifactForScope(input.previousChartId ?? "", artifactScope(ctx));
  if (saved.kind !== "chart-spec")
    throw new Error("previousChartId must identify a saved chart specification");
  return savedChartSchema.parse(JSON.parse((await artifactBytes(saved)).toString())).rows;
}

export async function createChart(input: z.output<typeof chartInputSchema>, ctx: ToolContext) {
  const rows = await rowsForChart(input, ctx);
  const rendered = await renderChart(rows, input.spec);
  const scope = artifactScope(ctx);
  const metadata = { title: input.spec.title, alt: input.spec.alt, source: input.spec.source };
  const base = { key: ctx.callId, metadata, retained: input.retained };
  const saved = await saveArtifact(scope, {
    ...base,
    kind: "chart-spec",
    filename: "chart.json",
    mediaType: "application/json",
    body: Buffer.from(JSON.stringify({ spec: input.spec, rows })),
  });
  const files = [
    { filename: "chart.png", mediaType: "image/png", body: rendered.png },
    { filename: "chart.svg", mediaType: "image/svg+xml", body: Buffer.from(rendered.svg) },
    { filename: "data.csv", mediaType: "text/csv", body: Buffer.from(chartCsv(rows)) },
  ];
  const artifacts = [];
  for (const exportFile of files) {
    const stored = await saveArtifact(scope, { ...base, ...exportFile, kind: "chart" });
    artifacts.push({
      id: stored.id,
      filename: stored.filename,
      mediaType: stored.mediaType,
      bytes: stored.bytes,
    });
  }
  await attachArtifacts(
    artifacts.map((item) => item.id),
    scope,
  );
  return {
    ok: true,
    chartId: saved.id,
    artifacts,
    alt: input.spec.alt,
    rows: rows.length,
    delivery: "Attached to the final Discord reply",
  };
}
