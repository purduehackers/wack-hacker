import type { BadgeEvent, Settings } from "./contracts.ts";

// Organizer-owned production choices. A configured size change requires another confirmation.
// Key exceptions by exact CMS version, including trailing zeros (for example a long sword).
const sizeByVersion: Readonly<Record<string, number>> = {};
export const ACRYLIC_THICKNESS_MM = 3.175;
export const MIN_BADGE_SIZE_IN = 1.8;
export const BADGE_SIZE_STEP_IN = 0.05;
export function productionSettings(event?: BadgeEvent): Settings {
  return {
    material: "Acrylic",
    badgeSizeIn: (event && sizeByVersion[event.version]) ?? 2.2,
    stampSizeIn: 1.5,
    gapMm: 0.2,
  };
}
