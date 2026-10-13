import { XMLSerializer } from "@xmldom/xmldom";

import { assertSimple, bounds, flatten } from "./geometry.ts";
import { inspectSvg, parseSvg, renderSvg } from "./svg.ts";

export function physicalDimensions(cut: string, role: "badge" | "stamp", sizeIn: number) {
  const points = flatten(cut, 0.001);
  assertSimple(points);
  const box = bounds(points);
  const width = box.maxX - box.minX,
    height = box.maxY - box.minY;
  const scale =
    (sizeIn * 25.4) / (role === "stamp" ? Math.min(width, height) : Math.max(width, height));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid physical cut dimensions.");
  return { box, scale, widthIn: (width * scale) / 25.4, heightIn: (height * scale) / 25.4 };
}

/** Physical dimensions are derived from the cut contour, never the export canvas. */
export function physicalSvg(
  source: string,
  role: "badge" | "stamp",
  sizeIn: number,
  mirror: boolean,
): string {
  const { cut } = inspectSvg(source, role);
  const { box, scale, widthIn, heightIn } = physicalDimensions(cut, role, sizeIn);
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
  const w = widthIn * 25.4,
    h = heightIn * 25.4;
  if (role === "stamp" && Math.abs(sizeIn - 1.5) > 1e-9)
    throw new Error("Stamp shortest side must be 1.5 inches.");
  const transform = `${mirror ? `translate(${w + 0.5} 0.5) scale(-1 1)` : "translate(0.5 0.5)"} scale(${scale}) translate(${-box.minX} ${-box.minY})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 1}mm" height="${h + 1}mm" viewBox="0 0 ${w + 1} ${h + 1}"><g transform="${transform}">${artwork}</g></svg>`;
}

export function renderManufacturing(source: string): Uint8Array {
  return renderSvg(source);
}
