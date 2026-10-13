import { Resvg } from "@resvg/resvg-js";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import svgpath from "svgpath";

import { checkIds, hash, MAX_SVG_BYTES } from "./contracts.ts";
import type { Check } from "./contracts.ts";
import { assertSimple, flatten } from "./geometry.ts";

const namespace = "http://www.w3.org/2000/svg";
const drawable = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "text",
  "image",
]);
const supported = new Set(["svg", "g", "defs", "metadata", "title", "desc", ...drawable]);
const properties = [
  "fill",
  "stroke",
  "stroke-width",
  "fill-opacity",
  "stroke-opacity",
  "visibility",
];
const allowedAttributes = new Set([
  "xmlns",
  "id",
  "version",
  "width",
  "height",
  "viewBox",
  "preserveAspectRatio",
  "transform",
  "style",
  "opacity",
  "display",
  "fill-rule",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  ...properties,
]);
const allowedStyles = new Set([
  ...properties,
  "opacity",
  "display",
  "fill-rule",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
]);

export function parseSvg(input: string) {
  const source = input.replace(/^\s*<\?xml\s[^?]*\?>/u, "");
  if (Buffer.byteLength(source) > MAX_SVG_BYTES || /<!DOCTYPE|<!ENTITY|<\?/iu.test(source)) {
    throw new Error("Export a plain SVG under 1 MB, without XML directives or entities.");
  }
  const document = new DOMParser({
    onError: (level, detail) => {
      throw new Error(`Invalid SVG (${level}): ${detail.slice(0, 200)}`);
    },
  }).parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg" || root.namespaceURI !== namespace)
    throw new Error("Expected an SVG document.");
  validateViewport(root);
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  if (elements.length > 5000)
    throw new Error("SVG has too many elements. Simplify it before uploading.");
  for (const node of elements) {
    if (["script", "foreignObject", "use", "image", "style"].includes(node.localName ?? "")) {
      throw new Error(
        "Only self-contained vector SVGs are accepted. Remove images, linked objects, scripts, and stylesheets.",
      );
    }
    if (node.namespaceURI !== namespace) {
      node.parentNode?.removeChild(node);
      continue;
    }
    let depth = 0,
      parent = node.parentNode;
    while (parent) {
      depth += 1;
      if (depth > 64) throw new Error("SVG nesting exceeds the supported depth.");
      parent = parent.parentNode;
    }
    for (const attribute of Array.from(node.attributes)) {
      if (
        /^on|href$/iu.test(attribute.name) ||
        /url\s*\(|@import|expression\s*\(/iu.test(attribute.value)
      ) {
        throw new Error("SVG contains an external reference or executable content.");
      }
    }
  }
  return { root, elements };
}

function color(value: string): string | undefined {
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    gray: "#808080",
    grey: "#808080",
  };
  const lower = value.toLowerCase();
  if (named[lower]) return named[lower];
  if (/^#[a-f\d]{6}$/u.test(lower)) return lower;
  if (/^#[a-f\d]{3}$/u.test(lower))
    return `#${lower
      .slice(1)
      .split("")
      .map((digit) => digit + digit)
      .join("")}`;
  return undefined;
}

function localStyle(element: Element): Map<string, string> {
  const style = new Map(
    Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]),
  );
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0)
      style.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return style;
}

export interface SvgFacts {
  checks: Check[];
  source: string;
  cut: string;
}

interface Observations {
  unknown: Set<string>;
  palette: Set<string>;
  strokes: number;
  text: number;
  cuts: string[];
  badCuts: boolean;
}

function observe(
  element: Element,
  inherited: Map<string, string>,
  ancestorTransform: string,
  observations: Observations,
): void {
  const tag = element.localName ?? "";
  const local = localStyle(element);
  const style = new Map(inherited);
  for (const property of properties) {
    const value = local.get(property);
    if (value !== undefined && value !== "inherit") style.set(property, value);
  }
  inspectVisibility(element, local, observations);
  for (const attribute of Array.from(element.attributes)) {
    if (
      !allowedAttributes.has(attribute.name) &&
      !attribute.name.startsWith("data-") &&
      !attribute.namespaceURI
    )
      observations.unknown.add(attribute.name);
  }
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const name = declaration.split(":")[0]?.trim();
    if (name && !allowedStyles.has(name)) observations.unknown.add(name);
  }
  if (!supported.has(tag) || (tag === "svg" && element.parentNode?.nodeType === 1))
    observations.unknown.add(tag);
  const transform = `${ancestorTransform} ${element.getAttribute("transform") ?? ""}`.trim();
  if (drawable.has(tag)) observePaint(element, style, transform, observations);
  for (const child of Array.from(element.children)) observe(child, style, transform, observations);
}

function observePaint(
  element: Element,
  style: Map<string, string>,
  transform: string,
  observations: Observations,
): void {
  const tag = element.localName;
  if (tag === "text") observations.text += 1;
  const fill = style.get("fill") ?? "#000000";
  const stroke = style.get("stroke") ?? "none";
  if (color(fill) === "#ff0000") observations.badCuts = true;
  for (const paint of [fill, stroke]) {
    if (paint === "none") continue;
    const hex = color(paint);
    if (hex === undefined) observations.unknown.add(`paint ${paint}`);
    else observations.palette.add(hex);
  }
  if (stroke === "none") return;
  if (color(stroke) !== "#ff0000") {
    observations.strokes += 1;
    return;
  }
  const path = element.getAttribute("d") ?? "";
  const parsed = svgpath(path);
  if (
    tag !== "path" ||
    ("err" in parsed && parsed.err !== "") ||
    fill !== "none" ||
    !/[zZ]\s*$/u.test(path) ||
    (path.match(/[mM]/gu)?.length ?? 0) !== 1 ||
    /[aA]/u.test(path)
  ) {
    observations.badCuts = true;
    return;
  }
  observations.cuts.push(parsed.transform(transform).abs().unshort().toString());
}

function checkCut(observation: Observations): Pick<Check, "status" | "detail"> {
  const cut = observation.cuts[0];
  if (observation.cuts.length !== 1 || observation.badCuts || !cut)
    return {
      status: "unknown",
      detail:
        "Export one closed, unfilled red exterior path with cubic/quadratic/line segments. Compound, open, arc, or multiple cut outlines need a simplified export.",
    };
  try {
    assertSimple(flatten(cut, 0.01));
    return {
      status: "pass",
      detail:
        "One closed, unfilled red cut path without crossings or retraced edges. Geometry is checked again at manufacturing size.",
    };
  } catch (cause) {
    return {
      status: "fail",
      detail: cause instanceof Error ? cause.message : "Invalid cut geometry.",
    };
  }
}

export function inspectSvg(source: string, role: "badge" | "stamp"): SvgFacts {
  const { root } = parseSvg(source);
  const observation: Observations = {
    unknown: new Set(),
    palette: new Set(),
    strokes: 0,
    text: 0,
    cuts: [],
    badCuts: false,
  };
  observe(root, new Map(), "", observation);
  const disallowed = [...observation.palette].filter(
    (value) =>
      value !== "#ff0000" &&
      (role === "stamp"
        ? !["#000000", "#ffffff"].includes(value)
        : !(value.slice(1, 3) === value.slice(3, 5) && value.slice(3, 5) === value.slice(5, 7))),
  );
  const statuses: Record<Check["id"], { status: Check["status"]; detail: string }> = {
    supported: {
      status: observation.unknown.size ? "unknown" : "pass",
      detail: observation.unknown.size
        ? `Re-export plain paths. Unsupported SVG features: ${[...observation.unknown].join(", ").slice(0, 2400)}`
        : "Plain vector geometry and supported inherited paints.",
    },
    palette: {
      status: disallowed.length ? "fail" : "pass",
      detail: disallowed.length
        ? `Replace these colors: ${disallowed.join(", ")}.`
        : role === "badge"
          ? "Grayscale engraving and exact red cut lines."
          : "Black/white engraving and exact red cut lines.",
    },
    vectors: { status: "pass", detail: "No raster or external content." },
    text: {
      status: observation.text ? "fail" : "pass",
      detail: observation.text ? "Convert all text to vector outlines." : "No live text elements.",
    },
    fills: {
      status: observation.strokes ? "fail" : "pass",
      detail: observation.strokes
        ? "Outline engraving strokes. Red cutting strokes stay strokes."
        : "Engraving uses fills; cutting uses red strokes.",
    },
    cut: checkCut(observation),
  };
  return {
    checks: checkIds.map((id) => ({ id, role, ...statuses[id], evidenceId: hash(source) })),
    source: new XMLSerializer().serializeToString(root),
    cut: observation.cuts[0] ?? "",
  };
}

export function renderSvg(source: string): Uint8Array {
  const { root } = parseSvg(source);
  const box = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/u).map(Number);
  const mode = (box[2] ?? 1) >= (box[3] ?? 1) ? "width" : "height";
  return new Resvg(source, {
    background: "white",
    fitTo: { mode, value: 1024 },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
}

function validateViewport(root: Element): void {
  const viewport = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  const [, , width, height] = viewport;
  if (
    viewport.length !== 4 ||
    !viewport.every(Number.isFinite) ||
    !width ||
    !height ||
    width <= 0 ||
    height <= 0 ||
    width / height > 100 ||
    height / width > 100
  )
    throw new Error("Use a finite viewBox with a sensible aspect ratio (under 100:1).");
}

function inspectVisibility(
  element: Element,
  local: Map<string, string>,
  observations: Observations,
): void {
  const tag = element.localName;
  // Invisible or reusable artwork cannot establish visible manufacturing evidence.
  if (tag === "defs" && element.children.length) observations.unknown.add("artwork in defs");
  for (const key of ["opacity", "fill-opacity", "stroke-opacity"]) {
    const value = local.get(key);
    if (value !== undefined && !["1", "100%", "inherit"].includes(value))
      observations.unknown.add(`non-opaque ${key}`);
  }
  if (
    ["none", "hidden", "collapse"].includes(local.get("display") ?? local.get("visibility") ?? "")
  )
    observations.unknown.add("hidden artwork");
}
