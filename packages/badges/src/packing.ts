import { Resvg } from "@resvg/resvg-js";
import { XMLSerializer } from "@xmldom/xmldom";
import type { Path } from "clipper-lib";

import { hash } from "./contracts.ts";
import type { Layout, Settings } from "./contracts.ts";
import {
  bounds,
  assertSimple,
  clip,
  Clipper,
  flatten,
  fromPath,
  MARGIN,
  offset,
  rotate,
  SCALE,
  SHEETS,
  toPath,
  translate,
} from "./geometry.ts";
import type { Point } from "./geometry.ts";
import { physicalDimensions } from "./manufacturing.ts";
import type { BadgeStore } from "./store.ts";
import { parseSvg } from "./svg.ts";

type Placement = Layout["placements"][number];
interface Shape {
  points: Point[];
  searchPoints: Point[];
  center: Point;
  scale: number;
  widthIn: number;
  heightIn: number;
}

function shapeAt(cut: string, sizeIn: number): Shape {
  const { box, scale, widthIn, heightIn } = physicalDimensions(cut, "badge", sizeIn);
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const points = flatten(cut, 0.01 / scale).map((p) => ({
    x: (p.x - center.x) * scale,
    y: (p.y - center.y) * scale,
  }));
  if (points.length > 384)
    throw new Error(
      "Cut outline exceeds the 384-vertex packing budget. Simplify the exterior path.",
    );
  assertSimple(points);
  const simple = Clipper.Clipper.SimplifyPolygon(toPath(points), Clipper.PolyFillType.pftNonZero);
  if (
    simple.length !== 1 ||
    !simple[0] ||
    Math.abs(Clipper.Clipper.Area(simple[0])) < SCALE * SCALE
  )
    throw new Error("Cut outline is disconnected, self-intersecting, or too small.");
  const searchPoints = flatten(cut, 0.1 / scale).map((p) => ({
    x: (p.x - center.x) * scale,
    y: (p.y - center.y) * scale,
  }));
  if (searchPoints.length > 128)
    throw new Error(
      "Cut outline exceeds the 128-vertex search budget. Simplify the exterior path.",
    );
  return { points, searchPoints, center, scale, widthIn, heightIn };
}

function nest(points: Point[], gap: number, deadline: number, attempt: number): Placement[] {
  const padded = offset(points, gap / 2 + 0.14);
  // Pick an orientation suited to long shapes, then allow quarter turns and flips.
  const baseAngle =
    [(attempt % 3) * 10, 30 + (attempt % 3) * 10, 60 + (attempt % 3) * 10]
      .map((angle) => ({ angle, box: bounds(rotate(padded, angle)) }))
      .sort(
        (a, b) =>
          (a.box.maxX - a.box.minX) * (a.box.maxY - a.box.minY) -
          (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY),
      )[0]?.angle ?? 0;
  const shapes = [0, 90, 180, 270].map((turn) => {
    const angle = baseAngle + turn,
      polygon = rotate(padded, angle);
    return { angle, polygon, box: bounds(polygon) };
  });
  const noFit = exclusionRegions(
    points,
    shapes.map((s) => s.angle),
    gap,
    deadline,
  );
  const placements: Placement[] = [];
  for (const [sheet, dimensions] of SHEETS.entries()) {
    while (placements.length < 100) {
      if (Date.now() > deadline)
        throw new Error("Packing reached its time budget. Try another layout.");
      const choices = shapes.flatMap((orientation) =>
        placementChoices({ orientation, dimensions, sheet, placements, noFit }),
      );
      const best = choices.sort((a, b) => a.score - b.score)[0];
      if (!best) break;
      placements.push(best.pose);
    }
  }
  return placements;
}

function placementChoices(input: {
  orientation: { angle: number; box: ReturnType<typeof bounds> };
  dimensions: { width: number; height: number };
  sheet: number;
  placements: Placement[];
  noFit: Map<string, Path>;
}): { pose: Placement; score: number }[] {
  const { orientation, dimensions, sheet, placements, noFit } = input;
  const { box } = orientation;
  const left = MARGIN - box.minX,
    right = dimensions.width - MARGIN - box.maxX,
    top = MARGIN - box.minY,
    bottom = dimensions.height - MARGIN - box.maxY;
  if (left > right || top > bottom) return [];
  const rectangle = toPath([
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]);
  const exclusions = placements
    .filter((p) => p.sheet === sheet)
    .map((p) => {
      const polygon = noFit.get(`${p.angle}:${orientation.angle}`);
      if (!polygon) throw new Error("Missing clearance geometry.");
      return polygon.map((point) => ({
        X: point.X + Math.round(p.x * SCALE),
        Y: point.Y + Math.round(p.y * SCALE),
      }));
    });
  return clip([rectangle], exclusions, Clipper.ClipType.ctDifference)
    .flatMap(fromPath)
    .filter(
      (p) =>
        p.x >= left - 0.001 && p.x <= right + 0.001 && p.y >= top - 0.001 && p.y <= bottom + 0.001,
    )
    .map((p) => ({
      pose: { sheet, ...p, angle: orientation.angle },
      score: p.y + box.maxY + p.x * 0.01,
    }));
}

/** Separate from the no-fit search: audit every expanded contour against sheet bounds and every other contour. */
export function audit(points: Point[], placements: Placement[], gap: number): void {
  const padded = offset(points, gap / 2 + 0.02);
  const placed = placements.map((pose) => ({
    ...pose,
    polygon: translate(rotate(padded, pose.angle), pose.x, pose.y),
  }));
  for (const [i, a] of placed.entries()) {
    const sheet = SHEETS[a.sheet];
    if (
      !sheet ||
      a.polygon.some(
        (p) =>
          p.x < MARGIN || p.y < MARGIN || p.x > sheet.width - MARGIN || p.y > sheet.height - MARGIN,
      )
    )
      throw new Error("Layout exceeds the sheet's 0.2-inch edge margin.");
    for (const b of placed.slice(i + 1)) {
      if (a.sheet !== b.sheet) continue;
      const intersection = clip(
        [toPath(a.polygon)],
        [toPath(b.polygon)],
        Clipper.ClipType.ctIntersection,
      );
      if (intersection.some((p) => Math.abs(Clipper.Clipper.Area(p)) > 1))
        throw new Error("Layout has overlapping badge clearances.");
    }
  }
}

function sheetSvg(source: string, shape: Shape, placements: Placement[], sheet: number): string {
  const dimensions = SHEETS[sheet];
  if (!dimensions) throw new Error("Unknown sheet.");
  const { root } = parseSvg(source);
  // A group preserves root presentation attributes, without a viewport that could crop the art.
  const document = root.ownerDocument;
  if (!document) throw new Error("Missing SVG document.");
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const attribute of Array.from(root.attributes))
    if (!["xmlns", "viewBox", "width", "height", "id"].includes(attribute.name))
      group.setAttribute(attribute.name, attribute.value);
  group.setAttribute("id", "badge-art");
  for (const child of Array.from(root.childNodes)) group.appendChild(child.cloneNode(true));
  const drawing = new XMLSerializer().serializeToString(group);
  const copies = placements
    .filter((p) => p.sheet === sheet)
    .map(
      (p) =>
        `<use href="#badge-art" transform="translate(${p.x} ${p.y}) rotate(${p.angle}) scale(${shape.scale}) translate(${-shape.center.x} ${-shape.center.y})"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}mm" height="${dimensions.height}mm" viewBox="0 0 ${dimensions.width} ${dimensions.height}"><defs>${drawing}</defs>${copies}</svg>`;
}

export async function pack(
  source: string,
  cut: string,
  settings: Settings,
  store: Pick<BadgeStore, "putAsset">,
  attempt = 0,
): Promise<Layout[]> {
  const sizeIn = settings.badgeSizeIn;
  const shape = shapeAt(cut, sizeIn);
  const placements = nest(shape.searchPoints, settings.gapMm, Date.now() + 45_000, attempt);
  // Bounded heuristic, not a proof of optimality or infeasibility. Never resize here.
  if (placements.length < 80)
    throw new Error(
      `The layout search found ${placements.length} badges at the approved size. It needs at least 80. Try another layout, or ask an organizer to adjust the configured size and review the badge again.`,
    );
  audit(shape.points, placements, settings.gapMm);
  const sheets = SHEETS.map((_, index) => sheetSvg(source, shape, placements, index));
  const previewSheets = sheets.map((svg, index) => {
    const dimensions = SHEETS[index];
    if (!dimensions) throw new Error("Unknown sheet.");
    return svg
      .replace(`width="${dimensions.width}mm"`, `width="${dimensions.width}"`)
      .replace(`height="${dimensions.height}mm"`, `height="${dimensions.height}"`);
  });
  const sheetHashes = await Promise.all(
    sheets.map((svg) => store.putAsset(Buffer.from(svg), "image/svg+xml")),
  );
  const preview = await store.putAsset(
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 325"><rect width="304.8" height="304.8" fill="white" stroke="#888"/><rect x="330" width="457.2" height="304.8" fill="white" stroke="#888"/><g>${previewSheets[0] ?? ""}</g><g transform="translate(330 0)">${previewSheets[1] ?? ""}</g></svg>`,
      {
        background: "white",
        fitTo: { mode: "width", value: 1200 },
        font: { loadSystemFonts: false },
      },
    )
      .render()
      .asPng(),
    "image/png",
  );
  return [
    {
      id: hash(JSON.stringify({ sheetHashes, sizeIn, count: placements.length })),
      sheets: sheetHashes,
      preview,
      sizeIn,
      widthIn: shape.widthIn,
      heightIn: shape.heightIn,
      count: placements.length,
      placements,
      audited: true,
    },
  ];
}

function exclusionRegions(
  points: Point[],
  angles: number[],
  gap: number,
  deadline: number,
): Map<string, Path> {
  const cache = new Map<number, Point[]>(),
    result = new Map<string, Path>();
  for (const a of angles)
    for (const b of angles) {
      const relative = (((b - a) % 360) + 360) % 360;
      let region = cache.get(relative);
      if (!region) {
        if (Date.now() > deadline) throw new Error("Packing reached its time budget.");
        const sums = Clipper.Clipper.MinkowskiSum(
          toPath(rotate(points, relative).map((p) => ({ x: -p.x, y: -p.y }))),
          toPath(points),
          true,
        );
        sums.sort((x, y) => Math.abs(Clipper.Clipper.Area(y)) - Math.abs(Clipper.Clipper.Area(x)));
        const outside = sums[0];
        if (!outside) throw new Error("Unable to construct clearance geometry.");
        region = offset(fromPath(outside), gap + 0.24);
        cache.set(relative, region);
      }
      const polygon = toPath(rotate(region, a));
      if (!Clipper.Clipper.Orientation(polygon)) polygon.reverse();
      result.set(`${a}:${b}`, polygon);
    }
  return result;
}
