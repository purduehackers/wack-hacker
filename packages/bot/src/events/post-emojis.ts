const KEYWORD_EMOJIS = [
  { emoji: "🎮", pattern: /\b(?:game|gaming|minecraft|roblox|godot|unity)\b/i },
  { emoji: "🎨", pattern: /\b(?:art|draw|drawing|paint|painting|illustration|design|figma)\b/i },
  { emoji: "🎵", pattern: /\b(?:music|song|album|audio|podcast|soundcloud)\b/i },
  { emoji: "📷", pattern: /\b(?:photo|photography|picture|camera)\b/i },
  { emoji: "🎬", pattern: /\b(?:video|film|movie|animation|youtube)\b/i },
  { emoji: "🤖", pattern: /\b(?:robot|robotics|bot|automation|automated)\b/i },
  {
    emoji: "🔧",
    pattern: /\b(?:hardware|circuit|pcb|solder|arduino|microcontroller|raspberry pi)\b/i,
  },
  { emoji: "🖨️", pattern: /\b(?:3d print(?:er|ing)?|printed|printer)\b/i },
  { emoji: "🦀", pattern: /\b(?:rust|cargo)\b/i },
  { emoji: "🐍", pattern: /\bpython\b/i },
  { emoji: "⚛️", pattern: /\breact(?:\.js)?\b/i },
  { emoji: "🌐", pattern: /\b(?:website|webpage|web app|browser)\b/i },
  { emoji: "📱", pattern: /\b(?:mobile|ios|android|iphone|ipad)\b/i },
  { emoji: "💻", pattern: /\b(?:github|repository|repo|pull request|open source)\b/i },
  { emoji: "🔒", pattern: /\b(?:security|privacy|encryption|cryptography)\b/i },
  { emoji: "📊", pattern: /\b(?:data|graph|chart|statistics|analytics)\b/i },
  { emoji: "🔬", pattern: /\b(?:science|research|experiment|laboratory)\b/i },
  { emoji: "📚", pattern: /\b(?:book|story|novel|writing|blog)\b/i },
  { emoji: "🍳", pattern: /\b(?:food|cook|cooking|recipe|baking|pizza)\b/i },
  { emoji: "🌱", pattern: /\b(?:plant|garden|flower|tree)\b/i },
  { emoji: "🗺️", pattern: /\b(?:map|travel|trip|journey)\b/i },
  { emoji: "🚲", pattern: /\b(?:bike|bicycle|cycling)\b/i },
  { emoji: "🚗", pattern: /\b(?:car|driving|vehicle)\b/i },
  { emoji: "🚀", pattern: /\b(?:space|rocket|satellite|launch)\b/i },
];

const FALLBACK_EMOJIS = ["🎉", "✨", "🚀"];

/** Pick the first three topic matches, filling any gaps with celebration emoji. */
export function selectPostEmojis(text: string): readonly string[] {
  const matches = KEYWORD_EMOJIS.map(({ emoji, pattern }) => ({
    emoji,
    index: text.search(pattern),
  }))
    .filter(({ index }) => index !== -1)
    .sort((left, right) => left.index - right.index);

  const emojis = new Set(matches.map(({ emoji }) => emoji));
  for (const fallback of FALLBACK_EMOJIS) emojis.add(fallback);
  return [...emojis].slice(0, 3);
}
