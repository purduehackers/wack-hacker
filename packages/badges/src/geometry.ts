import Clipper from "clipper-lib";
import type { Path, Paths } from "clipper-lib";
import svgpath from "svgpath";

export interface Point {
  x: number;
  y: number;
}
export const SCALE = 10_000;
export const MARGIN = 5.08;
export const SHEETS = [
  { width: 304.8, height: 304.8 },
  { width: 457.2, height: 304.8 },
];
export const toPath = (points: Point[]): Path =>
  points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
export const fromPath = (points: Path): Point[] =>
  points.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function bounds(points: Point[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function distance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function cubic(
  points: Point[],
  control: [Point, Point, Point, Point],
  tolerance: number,
  depth = 0,
): void {
  const [a, b, c, d] = control;
  if (points.length > 2000 || depth > 20)
    throw new Error("Cut outline is too complex to flatten safely.");
  if (Math.max(distance(b, a, d), distance(c, a, d)) <= tolerance) {
    points.push(d);
    return;
  }
  const ab = midpoint(a, b),
    bc = midpoint(b, c),
    cd = midpoint(c, d);
  const abc = midpoint(ab, bc),
    bcd = midpoint(bc, cd),
    m = midpoint(abc, bcd);
  cubic(points, [a, ab, abc, m], tolerance, depth + 1);
  cubic(points, [m, bcd, cd, d], tolerance, depth + 1);
}

export function flatten(path: string, tolerance: number): Point[] {
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  const parsed = svgpath(path).abs().unshort();
  if ("err" in parsed && parsed.err !== "") throw new Error("Invalid SVG cut path syntax.");
  parsed.iterate((segment) => {
    if (points.length > 2000) throw new Error("Cut outline exceeds the geometry budget.");
    switch (segment[0]) {
      case "M":
      case "L":
        current = { x: segment[1], y: segment[2] };
        break;
      case "H":
        current = { x: segment[1], y: current.y };
        break;
      case "V":
        current = { x: current.x, y: segment[1] };
        break;
      case "C": {
        const end = { x: segment[5], y: segment[6] };
        cubic(
          points,
          [current, { x: segment[1], y: segment[2] }, { x: segment[3], y: segment[4] }, end],
          tolerance,
        );
        current = end;
        return;
      }
      case "Q": {
        const end = { x: segment[3], y: segment[4] },
          control = { x: segment[1], y: segment[2] };
        cubic(
          points,
          [
            current,
            {
              x: current.x + ((control.x - current.x) * 2) / 3,
              y: current.y + ((control.y - current.y) * 2) / 3,
            },
            { x: end.x + ((control.x - end.x) * 2) / 3, y: end.y + ((control.y - end.y) * 2) / 3 },
            end,
          ],
          tolerance,
        );
        current = end;
        return;
      }
      case "Z":
      case "z":
        return;
      default:
        throw new Error(`Unsupported cut command ${segment[0]}. Convert arcs to cubic paths.`);
    }
    points.push(current);
  });
  if (points.length < 3 || !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    throw new Error("Invalid cut outline.");
  const first = points[0],
    last = points.at(-1);
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-8) points.pop();
  return points;
}

/** Reject crossings and retraced edges rather than silently repairing a cutting path. */
export function assertSimple(points: Point[]): void {
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length];
    if (!b || Math.hypot(b.x - a.x, b.y - a.y) < 1e-8)
      throw new Error("Remove repeated points from the cut path.");
    const next = points[(i + 2) % points.length];
    if (next && distance(next, a, b) < 1e-8)
      throw new Error("The cut path retraces an edge. Export a simple exterior contour.");
    for (let j = i + 2; j < points.length; j += 1) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (c && d && intersects(a, b, c, d))
        throw new Error(
          "The cut path crosses or touches itself. Export a simple exterior contour.",
        );
    }
  }
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    [distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b)].some(
      (value) => value < 1e-8,
    )
  )
    return true;
  const side = (p: Point, q: Point, r: Point) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

export function offset(points: Point[], amount: number): Point[] {
  const paths: Paths = [];
  const input = toPath(points);
  if (!Clipper.Clipper.Orientation(input)) input.reverse();
  const offsetter = new Clipper.ClipperOffset(2, 0.005 * SCALE);
  offsetter.AddPath(input, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon);
  offsetter.Execute(paths, amount * SCALE);
  if (paths.length !== 1 || !paths[0])
    throw new Error("Cut outline changes topology when clearance is added.");
  return fromPath(paths[0]);
}

export function rotate(points: Point[], angle: number): Point[] {
  const radians = (angle * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  return points.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}
export function translate(points: Point[], x: number, y: number): Point[] {
  return points.map((p) => ({ x: p.x + x, y: p.y + y }));
}

export function clip(subject: Paths, other: Paths, kind: Clipper.ClipType): Paths {
  const result: Paths = [],
    engine = new Clipper.Clipper();
  engine.AddPaths(subject, Clipper.PolyType.ptSubject, true);
  engine.AddPaths(other, Clipper.PolyType.ptClip, true);
  engine.Execute(kind, result, Clipper.PolyFillType.pftNonZero, Clipper.PolyFillType.pftNonZero);
  return result;
}
export { Clipper };

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
