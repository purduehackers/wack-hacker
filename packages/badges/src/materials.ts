// Acrylic presets from purduehackers/badges, commit 8598f7513f993f30389470c85b88427db46256f1.
export type MaterialType = "transparent" | "opaque" | "translucent" | "pearlescent";

export interface AcrylicMaterial {
  id: string;
  name: string;
  type: MaterialType;
  /** Body color of the acrylic */
  color: string;
  /** Color of laser-engraved areas */
  engraveColor: string;
}

export interface MaterialPhysicalProps {
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  transparent: boolean;
  opacity: number;
  envMapIntensity: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor?: string;
}

export interface MaterialTypeConfig {
  label: string;
  order: number;
  physical: MaterialPhysicalProps;
}

export const MATERIAL_TYPE_CONFIGS: Record<MaterialType, MaterialTypeConfig> = {
  transparent: {
    label: "Transparent",
    order: 0,
    physical: {
      roughness: 0.05,
      clearcoat: 0.8,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.6,
      envMapIntensity: 0.3,
      sheen: 0,
      sheenRoughness: 0,
    },
  },
  opaque: {
    label: "Opaque",
    order: 1,
    physical: {
      roughness: 0.1,
      clearcoat: 0.8,
      clearcoatRoughness: 0.05,
      transparent: false,
      opacity: 1,
      envMapIntensity: 0.3,
      sheen: 0,
      sheenRoughness: 0,
    },
  },
  translucent: {
    label: "Translucent",
    order: 2,
    physical: {
      roughness: 0.1,
      clearcoat: 0.8,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.93,
      envMapIntensity: 0.3,
      sheen: 0,
      sheenRoughness: 0,
    },
  },
  pearlescent: {
    label: "Pearlescent",
    order: 3,
    physical: {
      roughness: 0.45,
      clearcoat: 0.15,
      clearcoatRoughness: 0.3,
      transparent: false,
      opacity: 1,
      envMapIntensity: 0,
      sheen: 0.08,
      sheenRoughness: 0.25,
      sheenColor: "#ffffff",
    },
  },
};

// Canal Plastics Center acrylic sheet catalog
// https://www.canalplastic.com/collections/transparent-colored-acrylic-sheets
// https://www.canalplastic.com/collections/opaque-colored-acrylic-sheets
// https://www.canalplastic.com/collections/translucent-colored-acrylic-sheets

export const ACRYLIC_MATERIALS: AcrylicMaterial[] = [
  // ── Transparent ──────────────────────────────────────────
  {
    id: "transparent-light-blue",
    name: "Light Blue",
    type: "transparent",
    color: "#29a3d4",
    engraveColor: "#ffffff",
  },
  {
    id: "transparent-dark-blue",
    name: "Dark Blue",
    type: "transparent",
    color: "#1a4d8f",
    engraveColor: "#cce0ff",
  },
  {
    id: "transparent-teal",
    name: "Teal",
    type: "transparent",
    color: "#007a78",
    engraveColor: "#ccfffd",
  },
  {
    id: "transparent-mint-green",
    name: "Mint Green",
    type: "transparent",
    color: "#7fddbb",
    engraveColor: "#ffffff",
  },
  {
    id: "transparent-light-green",
    name: "Light Green",
    type: "transparent",
    color: "#6abf69",
    engraveColor: "#e0ffe0",
  },
  {
    id: "transparent-green",
    name: "Green",
    type: "transparent",
    color: "#1b6e3a",
    engraveColor: "#ccffcc",
  },
  {
    id: "transparent-green-edge",
    name: "Green Edge",
    type: "transparent",
    color: "#d4f5d4",
    engraveColor: "#ffffff",
  },
  {
    id: "transparent-yellow",
    name: "Yellow",
    type: "transparent",
    color: "#ffe040",
    engraveColor: "#ffffff",
  },
  {
    id: "transparent-gold",
    name: "Gold",
    type: "transparent",
    color: "#e6a817",
    engraveColor: "#fff5cc",
  },
  {
    id: "transparent-amber",
    name: "Amber",
    type: "transparent",
    color: "#c06010",
    engraveColor: "#ffe0b0",
  },
  {
    id: "transparent-red",
    name: "Red",
    type: "transparent",
    color: "#cc1122",
    engraveColor: "#ffcccc",
  },
  {
    id: "transparent-magenta",
    name: "Magenta",
    type: "transparent",
    color: "#e6007e",
    engraveColor: "#ffe0f0",
  },
  {
    id: "transparent-pink",
    name: "Pink",
    type: "transparent",
    color: "#f5a0b8",
    engraveColor: "#ffffff",
  },
  {
    id: "transparent-rose-gold",
    name: "Rose Gold",
    type: "transparent",
    color: "#e8b4a2",
    engraveColor: "#ffffff",
  },
  {
    id: "transparent-purple",
    name: "Purple",
    type: "transparent",
    color: "#6a1b9a",
    engraveColor: "#e8ccff",
  },
  {
    id: "transparent-gray-smoke",
    name: "Gray Smoke",
    type: "transparent",
    color: "#555555",
    engraveColor: "#dddddd",
  },
  {
    id: "transparent-bronze-smoke",
    name: "Bronze Smoke",
    type: "transparent",
    color: "#6b4226",
    engraveColor: "#e0ccb0",
  },
  {
    id: "transparent-aura",
    name: "Aura Iridescent",
    type: "transparent",
    color: "#c9a0dc",
    engraveColor: "#ffffff",
  },
  {
    id: "transparent-radiant",
    name: "Radiant Iridescent",
    type: "transparent",
    color: "#f0b0c0",
    engraveColor: "#ffffff",
  },

  // ── Opaque ───────────────────────────────────────────────
  { id: "opaque-white", name: "White", type: "opaque", color: "#f5f5f5", engraveColor: "#cccccc" },
  { id: "opaque-black", name: "Black", type: "opaque", color: "#1a1a1a", engraveColor: "#888888" },
  {
    id: "opaque-dark-blue",
    name: "Dark Blue",
    type: "opaque",
    color: "#1a3a6e",
    engraveColor: "#99b3d6",
  },
  { id: "opaque-red", name: "Red", type: "opaque", color: "#cc1122", engraveColor: "#f0a0a0" },
  {
    id: "opaque-turquoise",
    name: "Turquoise",
    type: "opaque",
    color: "#00a0a0",
    engraveColor: "#b0e8e8",
  },
  { id: "opaque-pink", name: "Pink", type: "opaque", color: "#e05090", engraveColor: "#f5c0d8" },
  { id: "opaque-gray", name: "Gray", type: "opaque", color: "#808080", engraveColor: "#c0c0c0" },
  {
    id: "opaque-yellow",
    name: "Yellow",
    type: "opaque",
    color: "#f0c020",
    engraveColor: "#fff5aa",
  },
  {
    id: "opaque-orange",
    name: "Orange",
    type: "opaque",
    color: "#e06010",
    engraveColor: "#f5c098",
  },
  {
    id: "opaque-baby-blue",
    name: "Baby Blue",
    type: "opaque",
    color: "#6ab4e8",
    engraveColor: "#d6ecf7",
  },

  // ── Translucent ──────────────────────────────────────────
  {
    id: "translucent-white",
    name: "White",
    type: "translucent",
    color: "#f0f0f0",
    engraveColor: "#cccccc",
  },
  {
    id: "translucent-red",
    name: "Red",
    type: "translucent",
    color: "#cc1122",
    engraveColor: "#f0a0a0",
  },
  {
    id: "translucent-blue",
    name: "Blue",
    type: "translucent",
    color: "#1a5faa",
    engraveColor: "#b0d0f0",
  },

  // ── Pearlescent ────────────────────────────────────────
  {
    id: "pearlescent-arctic-white",
    name: "Arctic White",
    type: "pearlescent",
    color: "#f0ebe6",
    engraveColor: "#c0b8b0",
  },
  {
    id: "pearlescent-iridescent-white",
    name: "Iridescent White",
    type: "pearlescent",
    color: "#e8e0f0",
    engraveColor: "#b8b0c0",
  },
  {
    id: "pearlescent-marble-white",
    name: "Marble White",
    type: "pearlescent",
    color: "#eae6de",
    engraveColor: "#c0bab0",
  },
  {
    id: "pearlescent-light-blue",
    name: "Light Blue",
    type: "pearlescent",
    color: "#8ec8e8",
    engraveColor: "#c8e0f0",
  },
  {
    id: "pearlescent-blue",
    name: "Blue",
    type: "pearlescent",
    color: "#2a6aaa",
    engraveColor: "#a0c0e0",
  },
  {
    id: "pearlescent-green",
    name: "Green",
    type: "pearlescent",
    color: "#3a8a5a",
    engraveColor: "#a0d8b8",
  },
  {
    id: "pearlescent-gold",
    name: "Gold",
    type: "pearlescent",
    color: "#c8a030",
    engraveColor: "#e8d898",
  },
  {
    id: "pearlescent-pink",
    name: "Pink",
    type: "pearlescent",
    color: "#e8a0b0",
    engraveColor: "#f0d0d8",
  },
  {
    id: "pearlescent-magenta",
    name: "Magenta",
    type: "pearlescent",
    color: "#c03078",
    engraveColor: "#e8a0c0",
  },
  {
    id: "pearlescent-fire-tortoise",
    name: "Fire Tortoise Shell",
    type: "pearlescent",
    color: "#a05820",
    engraveColor: "#d8b888",
  },
];

export const STAMP_RUBBER = {
  id: "stamp-rubber",
  name: "Stamp rubber",
  type: "opaque",
  color: "#787878",
  engraveColor: "#333333",
} satisfies AcrylicMaterial;
export const STOCK_MATERIALS: readonly AcrylicMaterial[] = [...ACRYLIC_MATERIALS, STAMP_RUBBER];
export function stockMaterial(id: string): AcrylicMaterial | undefined {
  return STOCK_MATERIALS.find((material) => material.id === id);
}
