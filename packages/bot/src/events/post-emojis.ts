/**
 * Pick three reactions from the words in a ship or checkpoint.
 *
 * Scrappy reacts to every matching keyword. Here the earliest matches win so
 * the bot adds exactly three distinct reactions, with familiar celebration
 * emojis filling slots when the post has little or no text.
 */

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
] as const;

const FALLBACK_EMOJIS = ["🎉", "✨", "🚀"] as const;

export function selectPostEmojis(text: string): readonly [string, string, string] {
  const matches: { readonly emoji: string; readonly index: number; readonly priority: number }[] =
    [];

  for (const [priority, { emoji, pattern }] of KEYWORD_EMOJIS.entries()) {
    const match = pattern.exec(text);
    if (match !== null) matches.push({ emoji, index: match.index, priority });
  }
  matches.sort((left, right) => left.index - right.index || left.priority - right.priority);

  const selected: string[] = [];
  for (const { emoji } of matches) {
    if (!selected.includes(emoji)) selected.push(emoji);
    if (selected.length === 3) break;
  }
  for (const emoji of FALLBACK_EMOJIS) {
    if (selected.length === 3) break;
    if (!selected.includes(emoji)) selected.push(emoji);
  }

  const [first, second, third] = selected;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("post emoji selection did not produce three reactions");
  }
  return [first, second, third];
}
