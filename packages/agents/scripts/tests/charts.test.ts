import { describe, expect, test } from "bun:test";

import { chartCsv, chartPoints, fieldValue } from "../../agent/lib/charts/data.ts";
import { renderChart } from "../../agent/lib/charts/render.ts";
import { chartInputSchema, chartSpecSchema } from "../../agent/lib/charts/spec.ts";
import type { ChartSpec } from "../../agent/lib/charts/spec.ts";

const base = {
  title: "Chart verification",
  x: "date",
  y: "value",
  source: "Synthetic test fixture",
  alt: "Synthetic values for rendering verification.",
};
function spec(options: Partial<ChartSpec> = {}) {
  return chartSpecSchema.parse({ ...base, type: "bar", ...options });
}

describe("chart semantics", () => {
  test("missing values stay unknown through aggregation", () => {
    const points = chartPoints(
      [{ date: "A", value: 5 }, { date: "A" }],
      spec({ aggregate: "sum" }),
    );
    expect(points[0]?.y).toBeNull();
    expect(() =>
      chartPoints(
        [
          { date: "A", value: 1 },
          { date: "A", value: 2 },
        ],
        spec(),
      ),
    ).toThrow("explicit aggregation");
  });
  test("calendar days, local timestamps and week boundaries are distinct", () => {
    const points = chartPoints(
      [
        { date: "2026-11-16", value: 1 },
        { date: "2026-11-16T02:00:00Z", value: 2 },
      ],
      spec({ timeBucket: "week", aggregate: "sum" }),
    );
    expect(points.map((datum) => datum.x)).toEqual(["2026-11-16", "2026-11-09"]);
  });
  test("forbids sums of percentages and ambiguous data sources", () => {
    expect(
      chartInputSchema.safeParse({
        spec: spec({ unit: "percentage", aggregate: "sum" }),
        rows: [{ date: "A", value: 20 }],
      }).success,
    ).toBe(false);
    expect(
      chartInputSchema.safeParse({
        spec: spec(),
        rows: [{ date: "A", value: 20 }],
        datasetId: "a".repeat(32),
      }).success,
    ).toBe(false);
  });
  test("reads named provider metrics and protects CSV formulas", () => {
    expect(fieldValue({ metrics: [{ type: "reactions", value: 42 }] }, "metrics.reactions")).toBe(
      42,
    );
    expect(chartCsv([{ name: '=HYPERLINK("malicious")', count: 5 }])).toContain(
      "' =".replace(" ", ""),
    );
  });
});

describe("chart rendering", () => {
  test("histograms bin large source tables and retain their series", async () => {
    const rows = Array.from({ length: 2000 }, (_, index) => ({
      date: index % 100,
      value: 1,
      group: index % 2 ? "Group A" : "Group B",
    }));
    const output = await renderChart(rows, spec({ type: "histogram", series: "group" }));
    expect(output.svg).toContain("Group A");
    expect(output.svg).toContain("Group B");
  });
  for (const type of [
    "line",
    "bar",
    "stacked-bar",
    "area",
    "scatter",
    "histogram",
    "heatmap",
    "donut",
  ] as const) {
    test(`${type} produces bounded SVG and PNG with bundled fonts`, async () => {
      const rows =
        type === "heatmap"
          ? [
              { date: "Monday", value: "AM", amount: 4 },
              { date: "Tuesday", value: "PM", amount: 7 },
            ]
          : [
              { date: 1, value: 4 },
              { date: 2, value: 7 },
            ];
      const rendered = await renderChart(
        rows,
        spec({ type, ...(type === "heatmap" ? { value: "amount" } : {}) }),
      );
      expect(rendered.svg).toContain("<svg");
      expect(rendered.svg).toContain("Chart verification");
      expect(rendered.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(rendered.png.length).toBeLessThan(8_000_000);
    });
  }
  test("light theme, long labels, sparse dates and multiple series render", async () => {
    const rows = [
      { date: "A sufficiently long label to wrap", value: 5, group: "One" },
      { date: "Another category", group: "Two" },
      { date: "Third category", value: 9, group: "Two" },
    ];
    const output = await renderChart(rows, spec({ theme: "light", series: "group" }));
    expect(output.svg).toContain("#faf8f2");
  });
});
