import type { BadgeEvent, Settings } from "./contracts.ts";

// Organizer-owned production choices. A size change requires another design confirmation.
// Key exceptions by exact CMS version, including trailing zeros (for example a long sword).
const sizeByVersion: Readonly<Record<string, number>> = {};
export const ACRYLIC_THICKNESS_MM = 3.175;
export function productionSettings(event?: BadgeEvent): Settings {
  return {
    material: "Acrylic",
    badgeSizeIn: (event && sizeByVersion[event.version]) ?? 2.2,
    stampSizeIn: 1.5,
    gapMm: 0.2,
  };
}
