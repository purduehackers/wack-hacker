import { describe, expect, test } from "bun:test";

import { Experimental_DecisionMockModelV4 as DecisionMockModelV4 } from "ai/test";
import data from "emojibase-data/en/data.json";

import { POST_EMOJI_CANDIDATES } from "./post-emoji-candidates.ts";
import { selectPostEmojis } from "./post-emojis.ts";

function scoredModel(
  textScores: Readonly<Record<string, number>>,
  visualScores: Readonly<Record<string, number>> = {},
) {
  return new DecisionMockModelV4({
    doDecide: async ({ questions, state }) => {
      const scores = state.some((part) => part.type === "file") ? visualScores : textScores;
      return {
        answers: Object.fromEntries(
          Object.keys(questions).map((emoji) => [
            emoji,
            { type: "score", score: scores[emoji] ?? 0 },
          ]),
        ),
        warnings: [],
      };
    },
  });
}

const picture = { data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" } as const;

describe("post emoji candidates", () => {
  const candidates = new Set(POST_EMOJI_CANDIDATES.map(({ emoji }) => emoji));

  test("keeps project objects, neutral variants and the robot", () => {
    expect(candidates.size).toBeGreaterThan(1_000);
    expect(candidates.size).toBe(POST_EMOJI_CANDIDATES.length);
    for (const entry of data.filter((entry) => entry.group === 7)) {
      expect(candidates.has(entry.emoji)).toBe(!["🔗", "⛓️", "⛓️‍💥"].includes(entry.emoji));
    }
    expect(candidates.has("🤖")).toBe(true);
    expect(candidates.has("🧑‍🔬")).toBe(true);
    expect(candidates.has("🔢")).toBe(true);
    expect(candidates.has("🔣")).toBe(true);
    expect(candidates.has("😀")).toBe(false);
  });

  test("excludes link, information, technologist and letter reactions from scoring", () => {
    for (const emoji of [
      "🔗",
      "⛓️",
      "⛓️‍💥",
      "ℹ️",
      "🧑‍💻",
      "👩‍💻",
      "👨🏻‍💻",
      "🔤",
      "🔠",
      "🔡",
      "🅰️",
      "🆎",
      "Ⓜ️",
      "🅿️",
      "🆗",
      "🈁",
      "🇦",
      "🇿",
      "®️",
      "🔝",
    ]) {
      expect(candidates.has(emoji)).toBe(false);
    }
  });
});

describe("post emoji ranking", () => {
  test("uses model scores rather than keyword order", async () => {
    const model = scoredModel({ "🧶": 4, "🧣": 3, "🛠️": 2, "🎮": 0.01, "🎉": 1 });
    expect(
      await selectPostEmojis(
        { text: "Not a game: I finished a scarf from loops of wool.", kind: "ship" },
        model,
      ),
    ).toEqual(["🧶", "🧣", "🛠️"]);
  });

  test("a flower website gets one flower alongside its illustration and interaction", async () => {
    const model = scoredModel(
      { "🖱️": 4, "🖌️": 3, "🌹": 4, "🔗": 4, ℹ️: 4, "🧑‍💻": 4, "🔠": 4 },
      { "🌷": 4, "🎴": 3.95, "🌻": 3.9, "🪴": 3.8, "🌹": 2, "🖌️": 2.5 },
    );
    expect(
      await selectPostEmojis(
        {
          text: "I painted a tulip that opens as you scroll https://example.org/garden",
          kind: "ship",
          images: [picture],
        },
        model,
      ),
    ).toEqual(["🌷", "🖌️", "🖱️"]);
  });

  test("flower playing cards also count as games when they are the strongest match", async () => {
    const model = scoredModel({ "🎴": 4, "🃏": 3.5, "🌸": 3, "🖌️": 2 });
    expect(
      await selectPostEmojis({ text: "I painted my own hanafuda deck", kind: "ship" }, model),
    ).toEqual(["🎴", "🖌️"]);
  });

  test("returns only the categories the post supports", async () => {
    const input = { text: "I knitted a scarf", kind: "checkpoint" } as const;
    expect(
      await selectPostEmojis(input, scoredModel({ "🧶": 4, "🪡": 3.9, "🧣": 3, "🎉": 1 })),
    ).toEqual(["🧶", "🧣"]);
    expect(await selectPostEmojis(input, scoredModel({ "🎉": 1 }))).toEqual([]);
  });
});

describe("post emoji scoring", () => {
  test("scores the entire catalog in bounded batches with bounded text", async () => {
    const seen = new Set<string>();
    const scored = scoredModel({ "🎨": 4, "🖌️": 3, "✨": 2 });
    const model = new DecisionMockModelV4({
      doDecide: async (options) => {
        expect(Object.keys(options.questions).length).toBeLessThanOrEqual(128);
        for (const key of Object.keys(options.questions)) {
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
        expect(options.state).toEqual([
          { type: "json", value: { kind: "checkpoint", text: "x".repeat(8_000) } },
        ]);
        return scored.doDecide(options);
      },
    });
    const link = "<https://example.org/" + "a".repeat(10_000) + ">";
    await selectPostEmojis({ text: link + "x".repeat(20_000), kind: "checkpoint" }, model);
    expect(seen.size).toBe(POST_EMOJI_CANDIDATES.length);
  });

  test("image relevance outweighs conflicting text by three to one", async () => {
    const model = scoredModel({ "🧶": 4, "🎨": 4, "🍰": 4 }, { "🎹": 4, "🎮": 3, "💻": 2 });
    expect(
      await selectPostEmojis({ text: "a scarf", kind: "ship", images: [picture] }, model),
    ).toEqual(["🎹", "🎮", "💻"]);
  });

  test.each(["", "<https://example.org/>"])(
    "scores only the available image for %j",
    async (text) => {
      const scored = scoredModel({}, { "🎹": 4, "🎵": 3, "🎧": 2 });
      const model = new DecisionMockModelV4({
        doDecide: async (options) => {
          expect(options.state).toMatchObject([
            { type: "json", value: { kind: "checkpoint" } },
            {
              type: "file",
              mediaType: picture.mediaType,
              data: { type: "data", data: picture.data },
            },
          ]);
          return scored.doDecide(options);
        },
      });
      expect(
        await selectPostEmojis({ text, kind: "checkpoint", images: [picture] }, model),
      ).toEqual(["🎹"]);
    },
  );

  test("skips inference for bare links without a preview", async () => {
    const model = new DecisionMockModelV4({
      doDecide: async () => {
        throw new Error("Unexpected inference for a bare link");
      },
    });
    const text = "https://example.org/one\n<https://example.org/two>";
    expect(await selectPostEmojis({ text, kind: "checkpoint" }, model)).toEqual([]);
  });

  test("rejects incomplete batches rather than ranking partial data", async () => {
    const model = new DecisionMockModelV4({
      doDecide: async () => ({ answers: {}, warnings: [] }),
    });
    expect(await rejected(selectPostEmojis({ text: "scarf", kind: "ship" }, model))).toContain(
      "exactly one answer for every question",
    );
  });

  test("rejects invalid scores", async () => {
    expect(
      await rejected(
        selectPostEmojis({ text: "scarf", kind: "ship" }, scoredModel({ "🧶": Number.NaN })),
      ),
    ).toContain("score must be in");
  });

  test("surfaces provider failures without fallback reactions", async () => {
    const model = new DecisionMockModelV4({
      doDecide: async () => {
        throw new Error("provider unavailable");
      },
    });
    expect(await rejected(selectPostEmojis({ text: "scarf", kind: "ship" }, model))).toContain(
      "provider unavailable",
    );
  });
});

async function rejected(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (cause) {
    if (cause instanceof Error) return cause.message;
    throw cause;
  }
  throw new Error("Expected a rejected promise");
}
