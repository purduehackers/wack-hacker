// Discord assigns each user a colored default avatar; mirror that so the
// channel doesn't read as a wall of identical blurple circles.
const PALETTE = ["#5865f2", "#3ba55d", "#e67e22", "#ed4245", "#eb459e", "#9b59b6", "#11806a"];

export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function initials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}
