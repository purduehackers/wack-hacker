import { XMLSerializer } from "@xmldom/xmldom";

import { MIN_BADGE_LONG_SIDE_IN, MIN_BADGE_SHORT_SIDE_IN } from "./contracts.ts";
import { assertSimple, bounds, flatten } from "./geometry.ts";
import { inspectSvg, parseSvg, renderSvg } from "./svg.ts";

/** Physical dimensions are derived from the cut contour, never the export canvas. */
export function physicalSvg(
  source: string,
  role: "badge" | "stamp",
  sizeIn: number,
  mirror: boolean,
): string {
  const { cut } = inspectSvg(source, role);
  const points = flatten(cut, 0.001);
  assertSimple(points);
  const box = bounds(points);
  const width = box.maxX - box.minX,
    height = box.maxY - box.minY;
  const scale = (sizeIn * 25.4) / Math.max(width, height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid physical cut dimensions.");
  const { root } = parseSvg(source),
    document = root.ownerDocument;
  if (!document) throw new Error("Missing SVG document.");
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const attribute of Array.from(root.attributes))
    if (!["xmlns", "viewBox", "width", "height"].includes(attribute.name))
      group.setAttribute(attribute.name, attribute.value);
  for (const child of Array.from(root.childNodes)) group.appendChild(child.cloneNode(true));
  const artwork = new XMLSerializer().serializeToString(group);
  // The 0.5 mm preview/export bleed keeps the cut stroke visible without changing cut size.
  const w = width * scale,
    h = height * scale;
  if (
    role === "badge" &&
    (sizeIn < MIN_BADGE_LONG_SIDE_IN || Math.min(w, h) / 25.4 + 1e-9 < MIN_BADGE_SHORT_SIDE_IN)
  )
    throw new Error(
      "Badge cut dimensions must have a longer side ≥2 inches and shorter side ≥1.7 inches.",
    );
  if (role === "stamp" && sizeIn > 1.5)
    throw new Error("Stamp cut dimensions must not exceed 1.5 inches.");
  const transform = `${mirror ? `translate(${w + 0.5} 0.5) scale(-1 1)` : "translate(0.5 0.5)"} scale(${scale}) translate(${-box.minX} ${-box.minY})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 1}mm" height="${h + 1}mm" viewBox="0 0 ${w + 1} ${h + 1}"><g transform="${transform}">${artwork}</g></svg>`;
}

export function renderManufacturing(source: string): Uint8Array {
  return renderSvg(source);
}
