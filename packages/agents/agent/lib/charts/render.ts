import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";
import { init } from "echarts";
import type { EChartsOption, SeriesOption } from "echarts";
import { z } from "zod";

import { chartPoints, fieldValue } from "./data.ts";
import type { ChartPoint } from "./data.ts";
import { INTER_FONT_BASE64 } from "./font-data.ts";
import type { ChartRow, ChartSpec } from "./spec.ts";

const PALETTE = [
  "#f6cb52",
  "#7ad9ba",
  "#b5a0ef",
  "#f78e79",
  "#70b8ef",
  "#e399ce",
  "#b7cf72",
  "#deab76",
  "#8bc8cb",
  "#cfb4aa",
  "#b4bce4",
  "#a9d1ba",
];
let fontReady: Promise<string> | undefined;

function bundledFont(): Promise<string> {
  fontReady ??= (async () => {
    const path = join(tmpdir(), "wack-inter-v1.ttf");
    await writeFile(path, Buffer.from(INTER_FONT_BASE64, "base64"), { mode: 0o600 });
    return path;
  })();
  return fontReady;
}

function commonOptions(spec: ChartSpec): EChartsOption {
  const dark = spec.theme === "dark";
  const text = dark ? "#f6f1e7" : "#24211d";
  const muted = dark ? "#aaa69d" : "#6b655c";
  const footer = [
    spec.source,
    spec.period,
    spec.timezone,
    spec.updatedAt ? `Updated ${spec.updatedAt}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    animation: false,
    backgroundColor: dark ? "#171715" : "#faf8f2",
    color: PALETTE,
    textStyle: { fontFamily: "Inter", color: text },
    title: [
      {
        text: "PURDUE HACKERS / DATA",
        left: 38,
        top: 24,
        textStyle: { color: dark ? "#f6cb52" : "#8c6200", fontSize: 12, fontWeight: 600 },
      },
      {
        text: spec.title,
        subtext: spec.subtitle ?? "",
        left: 38,
        top: 55,
        textStyle: {
          color: text,
          fontSize: 28,
          fontWeight: 600,
          width: spec.width - 80,
          overflow: "break",
        },
        subtextStyle: { color: muted, fontSize: 14 },
      },
    ],
    legend: { top: 116, textStyle: { color: muted }, itemWidth: 14, itemHeight: 9 },
    grid: { top: 165, left: 85, right: 50, bottom: 105, containLabel: true },
    graphic: [
      {
        type: "text",
        left: 40,
        bottom: 22,
        style: {
          text: footer,
          fill: muted,
          font: "12px Inter",
          width: spec.width - 80,
          overflow: "break",
        },
      },
    ],
  };
}

function histogram(points: readonly ChartPoint[], spec: ChartSpec): ChartPoint[] {
  const observations = points.map((datum) => z.number().parse(datum.x));
  const low = Math.min(...observations);
  const high = Math.max(...observations);
  if (!Number.isFinite(high - low)) throw new Error("Histogram range exceeds numeric limits");
  const step = (high - low || 1) / spec.bins;
  const binsBySeries = new Map<string, number[]>();
  for (const datum of points) {
    const value = z.number().parse(datum.x);
    const group = spec.series ? datum.series : "Count";
    const counts = binsBySeries.get(group) ?? Array.from({ length: spec.bins }, () => 0);
    const index = Math.min(spec.bins - 1, Math.floor((value - low) / step));
    counts[index] = (counts[index] ?? 0) + 1;
    binsBySeries.set(group, counts);
  }
  return [...binsBySeries].flatMap(([group, counts]) =>
    counts.map((frequency, index) => ({
      x: `${(low + index * step).toFixed(1)}–${(low + (index + 1) * step).toFixed(1)}`,
      y: frequency,
      series: group,
    })),
  );
}

function cartesianOptions(points: readonly ChartPoint[], spec: ChartSpec): EChartsOption {
  const categories = [...new Set(points.map((datum) => datum.x))];
  const names = [...new Set(points.map((datum) => datum.series))];
  const gridColor = spec.theme === "dark" ? "#34342f" : "#e4dfd5";
  const series: SeriesOption[] = names.map((seriesName) => {
    const matching = points.filter((datum) => datum.series === seriesName);
    if (spec.type === "scatter")
      return {
        name: seriesName,
        type: "scatter",
        symbolSize: 10,
        data: matching.map((datum) => [z.number().parse(datum.x), datum.y]),
      };
    const data = categories.map((category) => {
      // oxlint-disable-next-line unicorn/no-null -- ECharts null leaves a gap where this series has no measurement
      return matching.find((datum) => datum.x === category)?.y ?? null;
    });
    const annotation = {
      data: spec.annotations.map((datum) => ({
        name: datum.label,
        coord: [datum.x, datum.y],
        value: datum.label,
      })),
    };
    if (spec.type === "line" || spec.type === "area")
      return {
        name: seriesName,
        type: "line",
        data,
        smooth: false,
        connectNulls: false,
        symbolSize: 7,
        lineStyle: { width: 3 },
        ...(spec.type === "area" ? { areaStyle: { opacity: 0.16 } } : {}),
        markPoint: annotation,
      };
    return {
      name: seriesName,
      type: "bar",
      data,
      barMaxWidth: 52,
      ...(spec.type === "stacked-bar" ? { stack: "total" } : {}),
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      markPoint: annotation,
    };
  });
  return {
    xAxis: {
      type: spec.type === "scatter" ? "value" : "category",
      ...(spec.type === "scatter" ? {} : { data: categories }),
      name: spec.xLabel ?? "",
      nameLocation: "middle",
      nameGap: 50,
      axisLabel: {
        color: spec.theme === "dark" ? "#ccc7bc" : "#514b42",
        rotate: categories.length > 12 ? 30 : 0,
        width: 110,
        overflow: "truncate",
      },
      nameTextStyle: { color: spec.theme === "dark" ? "#ccc7bc" : "#514b42" },
      axisLine: { lineStyle: { color: gridColor } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: spec.yLabel ?? spec.y,
      nameGap: 20,
      splitLine: { lineStyle: { color: gridColor } },
      axisLabel: {
        color: spec.theme === "dark" ? "#ccc7bc" : "#514b42",
        formatter: spec.unit === "percentage" ? "{value}%" : "{value}",
      },
      nameTextStyle: { color: spec.theme === "dark" ? "#ccc7bc" : "#514b42" },
    },
    series,
  };
}

function heatmapOptions(rows: readonly ChartRow[], spec: ChartSpec): EChartsOption {
  const data = rows.map((entry) => ({
    x: z.union([z.string(), z.number()]).parse(fieldValue(entry, spec.x)).toString(),
    y: z.union([z.string(), z.number()]).parse(fieldValue(entry, spec.y)).toString(),
    value: z.number().parse(fieldValue(entry, spec.value ?? "")),
  }));
  const xs = [...new Set(data.map((datum) => datum.x))];
  const ys = [...new Set(data.map((datum) => datum.y))];
  if (xs.length > 50 || ys.length > 50 || data.length > 1000)
    throw new Error("Heatmap exceeds 50 categories per axis or 1000 cells");
  if (new Set(data.map((datum) => JSON.stringify([datum.x, datum.y]))).size !== data.length)
    throw new Error("Aggregate duplicate heatmap cells before rendering");
  return {
    xAxis: {
      type: "category",
      data: xs,
      axisLabel: { color: spec.theme === "dark" ? "#ccc7bc" : "#514b42" },
    },
    yAxis: {
      type: "category",
      data: ys,
      axisLabel: { color: spec.theme === "dark" ? "#ccc7bc" : "#514b42" },
    },
    visualMap: {
      min: Math.min(...data.map((datum) => datum.value)),
      max: Math.max(...data.map((datum) => datum.value)),
      orient: "horizontal",
      bottom: 55,
      left: "center",
      inRange: { color: ["#303447", "#6b5c95", "#e7b65c"] },
      textStyle: { color: spec.theme === "dark" ? "#f6f1e7" : "#24211d" },
    },
    series: [
      {
        type: "heatmap",
        data: data.map((datum) => [xs.indexOf(datum.x), ys.indexOf(datum.y), datum.value]),
        label: { show: data.length < 80 },
      },
    ],
  };
}

export async function renderChart(rows: readonly ChartRow[], spec: ChartSpec) {
  if (rows.length === 0 || rows.length > 5000) throw new Error("Charts require 1–5000 rows");
  const points = spec.type === "heatmap" ? [] : chartPoints(rows, spec);
  const chart = init(undefined, undefined, {
    renderer: "svg",
    ssr: true,
    width: spec.width,
    height: spec.height,
  });
  try {
    let plot: EChartsOption;
    if (spec.type === "heatmap") plot = heatmapOptions(rows, spec);
    else if (spec.type === "donut") {
      if (points.length > 12 || points.some((datum) => datum.y === null || (datum.y ?? 0) < 0))
        throw new Error("Donut charts require at most 12 nonnegative, known observations");
      plot = {
        legend: {
          top: "auto",
          bottom: 70,
          textStyle: { color: spec.theme === "dark" ? "#f6f1e7" : "#24211d" },
        },
        series: [
          {
            type: "pie",
            radius: ["37%", "61%"],
            center: ["50%", "54%"],
            label: { formatter: "{b}: {c}", color: spec.theme === "dark" ? "#f6f1e7" : "#24211d" },
            data: points.map((datum) => ({ name: String(datum.x), value: datum.y ?? 0 })),
          },
        ],
      };
    } else
      plot = cartesianOptions(spec.type === "histogram" ? histogram(points, spec) : points, spec);
    chart.setOption({ ...commonOptions(spec), ...plot });
    const svg = chart.renderToSVGString();
    const fontFile = await bundledFont();
    const rendered = new Resvg(svg, {
      font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: "Inter" },
    });
    return { svg, png: rendered.render().asPng() };
  } finally {
    chart.dispose();
  }
}
