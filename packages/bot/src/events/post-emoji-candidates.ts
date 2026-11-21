import data from "emojibase-data/en/data.json";
import groups from "emojibase-data/meta/groups.json";

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
  "🎴": "hanafuda, a Japanese playing card game",
};

const PEOPLE_SUBGROUPS = new Set(["hand-prop", "body-parts", "person-role", "person-sport"]);
const EXCLUDED_REACTIONS = new Set([
  "🔗",
  "⛓️",
  "⛓️‍💥",
  "🧑‍💻",
  // Letter signs outside Unicode's alphanum subgroup.
  "©️",
  "®️",
  "™️",
  "🏧",
  "🚾",
  "🔙",
  "🔚",
  "🔛",
  "🔜",
  "🔝",
]);
const NONLETTER_INPUTS = new Set(["🔢", "🔣"]);

// A potted plant and a blossom can both describe the same flower. Likewise,
// notes, instruments and speakers often describe the same music.
const SHARED_CATEGORIES: Readonly<Record<string, string>> = {
  "plant-flower": "plant",
  "plant-other": "plant",
  "musical-instrument": "music",
  sound: "music",
};

export const POST_EMOJI_CANDIDATES = data.flatMap((entry) => {
  if (entry.group === undefined || entry.subgroup === undefined) return [];
  const subgroup = groups.subgroups[entry.subgroup];
  if (!subgroup || EXCLUDED_REACTIONS.has(entry.emoji)) return [];
  // This subgroup includes the information sign and the ABC/ABCD inputs.
  if (subgroup === "alphanum" && !NONLETTER_INPUTS.has(entry.emoji)) return [];

  const includedGroup = entry.group >= 3 && entry.group <= 8;
  const includedPerson = PEOPLE_SUBGROUPS.has(subgroup) && entry.gender === undefined;
  if (!includedGroup && !includedPerson && entry.emoji !== "🤖") return [];

  const category = SHARED_CATEGORIES[subgroup] ?? subgroup;
  const categories = [category];
  // Flower playing cards belong to games, but also repeat a flower's motif.
  if (category !== "plant" && entry.tags?.includes("flower")) categories.push("plant");
  return [
    {
      emoji: entry.emoji,
      meaning: PROJECT_MEANINGS[entry.emoji] ?? entry.label,
      categories,
    },
  ];
});
