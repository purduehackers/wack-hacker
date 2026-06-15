// Monochrome chrome icons (currentColor) matching Discord's muted grey
// composer + user-panel glyphs — colorful emoji would break the Discord look.

const S = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function GiftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <rect x="3" y="9" width="18" height="4" rx="1" />
      <path d="M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M12 9v12" />
      <path d="M12 9C12 6 10.5 4 8.8 4a2 2 0 0 0 0 5zM12 9c0-3 1.5-5 3.2-5a2 2 0 0 1 0 5z" />
    </svg>
  );
}

export function StickerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8l6-6V6a2 2 0 0 0-2-2z" />
      <path d="M14 20v-4a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export function EmojiIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14a4 4 0 0 0 7 0" />
      <circle cx="9" cy="10" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}
