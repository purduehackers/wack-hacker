import type { AcrylicMaterial } from "@repo/badges/materials";

export interface RenderInput {
  /** A checked, physical SVG with millimeter viewBox coordinates. */
  svg: string;
  material: AcrylicMaterial;
  thicknessMm: number;
}

declare global {
  interface Window {
    renderBadge(input: RenderInput): Promise<string>;
  }
}
