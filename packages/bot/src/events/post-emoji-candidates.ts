import data from "emojibase-data/en/data.json";

/** Extra project meanings supplement Unicode labels; these never match text in code. */
const PROJECT_MEANINGS: Readonly<Record<string, string>> = {
  "🤖": "robots, bots, automation",
  "🧠": "artificial intelligence, machine learning",
  "🦀": "crab, Rust programming",
  "🐍": "snake, Python programming",
  "⚛️": "atom, React interfaces",
  "🖨️": "printer, 3D printing and fabrication",
  "🕸️": "web, graphs and networks",
  "🐛": "bug, debugging",
  "🧵": "thread, sewing, concurrency",
  "🧶": "yarn, knitting and crochet",
  "💾": "storage, backups, retro computing",
};

/**
 * All animals/nature, food, travel/places, activities, objects and symbols.
 * Include useful body parts, professions and sports, using the neutral base
 * variants. Omit faces, families, flags and skin-tone/gender duplicates.
 * Robot is categorized as a face by Unicode but is useful for technology.
 */
export const POST_EMOJI_CANDIDATES = data
  .filter(
    (entry) =>
      (entry.group !== undefined && entry.group >= 3 && entry.group <= 8) ||
      (entry.group === 1 &&
        entry.subgroup !== undefined &&
        [21, 22, 25, 28].includes(entry.subgroup) &&
        entry.gender === undefined) ||
      entry.emoji === "🤖",
  )
  .map((entry) => ({
    emoji: entry.emoji,
    meaning: PROJECT_MEANINGS[entry.emoji] ?? entry.label,
  }));
