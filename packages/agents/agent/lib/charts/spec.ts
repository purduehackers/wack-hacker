import { z } from "zod";

import { artifactIdSchema } from "../artifacts/schema.ts";

export const chartSpecSchema = z.strictObject({
  type: z.enum(["line", "bar", "stacked-bar", "area", "scatter", "histogram", "heatmap", "donut"]),
  title: z.string().min(1).max(100),
  subtitle: z.string().max(160).optional(),
  x: z.string().min(1).max(100),
  y: z.string().min(1).max(100),
  value: z.string().min(1).max(100).optional().describe("Heatmap cell value field"),
  series: z.string().max(100).optional(),
  unit: z.enum(["count", "percentage", "currency", "number"]).default("number"),
  xLabel: z.string().max(60).optional(),
  yLabel: z.string().max(60).optional(),
  aggregate: z.enum(["none", "sum", "mean", "count"]).default("none"),
  timeBucket: z.enum(["day", "week", "month"]).optional(),
  sort: z.enum(["input", "ascending", "descending"]).default("input"),
  theme: z.enum(["light", "dark"]).default("dark"),
  width: z.int().min(600).max(1800).default(1200),
  height: z.int().min(400).max(1200).default(720),
  bins: z.int().min(2).max(50).default(12),
  source: z.string().min(1).max(180),
  period: z.string().max(100).optional(),
  timezone: z.string().max(80).default("America/Indiana/Indianapolis"),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  alt: z.string().min(1).max(1000),
  annotations: z
    .array(
      z.strictObject({
        label: z.string().max(50),
        x: z.union([z.string(), z.number()]),
        y: z.number(),
      }),
    )
    .max(10)
    .default([]),
});

export const chartInputSchema = z
  .strictObject({
    spec: chartSpecSchema,
    rows: z.array(z.record(z.string(), z.json())).min(1).max(5000).optional(),
    datasetId: artifactIdSchema.optional(),
    rowsPath: z
      .string()
      .max(200)
      .default("")
      .describe("Path into a dataset, e.g. pages.*.data.edges.*.node; * expands an array"),
    previousChartId: artifactIdSchema
      .optional()
      .describe("Reuse the saved rows from a previous chart with this replacement spec"),
    retained: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (
      [input.rows, input.datasetId, input.previousChartId].filter((value) => value !== undefined)
        .length !== 1
    )
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Supply exactly one of rows, datasetId, previousChartId",
      });
    if (input.spec.unit === "percentage" && input.spec.aggregate === "sum")
      ctx.addIssue({
        code: "custom",
        path: ["spec", "aggregate"],
        message: "Percentages cannot be summed",
      });
    if (input.spec.type === "heatmap" && !input.spec.value)
      ctx.addIssue({
        code: "custom",
        path: ["spec", "value"],
        message: "A heatmap requires a value field",
      });
  });

export type ChartSpec = z.output<typeof chartSpecSchema>;
export type ChartRow = Record<string, z.output<ReturnType<typeof z.json>>>;
