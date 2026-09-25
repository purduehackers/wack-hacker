import { postTextWithoutUrls } from "../utils/post-content.ts";

const KEYWORD_EMOJIS = [
  { emoji: "🎮", pattern: /\b(?:games?|gaming|minecraft|roblox|godot|unity)\b/i },
  {
    emoji: "🎨",
    pattern:
      /\b(?:art|draw|drawing|paint|painting|illustration|design|figma|sketch(?:es|books?|ing)?|shaders?|gradients?|redesign(?:ed|ing)?|logos?)\b/i,
  },
  { emoji: "🎵", pattern: /\b(?:music|songs?|album|audio|podcast|soundcloud|sounds?)\b/i },
  {
    emoji: "📷",
    pattern: /\b(?:photos?|photography|pictures?|cameras?|line cam|screenshots?)\b/i,
  },
  { emoji: "🎬", pattern: /\b(?:video|film|movie|animation|youtube)\b/i },
  { emoji: "🤖", pattern: /\b(?:robot|robotics|bot|automation|automated)\b/i },
  { emoji: "🧠", pattern: /\b(?:ai|llms?|claude|agents?|gpt|machine learning)\b/i },
  {
    emoji: "🔧",
    pattern: /\b(?:hardware|circuit|pcb|solder|arduino|microcontroller|raspberry pi)\b/i,
  },
  { emoji: "🖨️", pattern: /\b(?:3d print(?:er|ing)?|printed|printer)\b/i },
  { emoji: "🦀", pattern: /\b(?:rust|cargo)\b/i },
  { emoji: "🐍", pattern: /\bpython\b/i },
  { emoji: "⚛️", pattern: /\breact(?:\.js)?\b/i },
  {
    emoji: "🌐",
    pattern:
      /\b(?:sites?|websites?|webpages?|web apps?|browsers?|homepages?|web demo|web ?dev(?:elopment|elopers?)?)\b/i,
  },
  { emoji: "📱", pattern: /\b(?:mobile|ios|android|iphone|ipad|app store|play store)\b/i },
  { emoji: "💻", pattern: /\b(?:github|repository|repo|pull request|open source)\b/i },
  {
    emoji: "🧰",
    pattern:
      /\b(?:cli|tui|terminal|command[- ]line|parser|compiler|bytecode|plugin|browser extension|crate|dotfiles|scripting language|component library|developer tools?)\b/i,
  },
  { emoji: "🔒", pattern: /\b(?:security|privacy|encryption|cryptography)\b/i },
  { emoji: "📊", pattern: /\b(?:data|graph|chart|statistics|analytics|metrics|benchmarks?)\b/i },
  { emoji: "🔬", pattern: /\b(?:science|research|experiment|laboratory)\b/i },
  {
    emoji: "📚",
    pattern:
      /\b(?:books?|stor(?:y|ies)|novels?|writing|blogs?|scribbl(?:e|es|ed|ing)|journals?|poems?|poetry|essays?|notes)\b/i,
  },
  { emoji: "🧶", pattern: /\b(?:crochet(?:s|ed|ing)?|yarns?|knit(?:s|ted|ting)?)\b/i },
  {
    emoji: "🍳",
    pattern:
      /\b(?:foods?|cook|cooking|recipe|baking|pizza|cakes?|sourdough|dining|meals?|blueberry jam)\b/i,
  },
  { emoji: "🛍️", pattern: /\b(?:etsy|merch|clothing)\b/i },
  { emoji: "🌱", pattern: /\b(?:plant|garden|flower|tree)\b/i },
  { emoji: "🗺️", pattern: /\b(?:map|travel|trip|journey)\b/i },
  { emoji: "🚲", pattern: /\b(?:bike|bicycle|cycling)\b/i },
  { emoji: "🚗", pattern: /\b(?:car|trucks?|driving|vehicle)\b/i },
  { emoji: "✈️", pattern: /\b(?:airplanes?|planes?|flights?|aircraft|aviation)\b/i },
  { emoji: "🚀", pattern: /\b(?:space|rocket|satellite|launch|black hole)\b/i },
];

const FALLBACK_EMOJIS = ["🎉", "✨", "🚀"];

/** Pick the first three topic matches, filling any gaps with celebration emoji. */
export function selectPostEmojis(text: string): readonly string[] {
  const searchableText = postTextWithoutUrls(text);
  const matches = KEYWORD_EMOJIS.map(({ emoji, pattern }) => ({
    emoji,
    index: searchableText.search(pattern),
  }))
    .filter(({ index }) => index !== -1)
    .sort((left, right) => left.index - right.index);

  const emojis = new Set(matches.map(({ emoji }) => emoji));
  for (const fallback of FALLBACK_EMOJIS) emojis.add(fallback);
  return [...emojis].slice(0, 3);
}
