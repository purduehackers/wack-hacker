import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockGetAll } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockGetAll: vi.fn(),
}));

vi.mock("@vercel/edge-config", () => ({
  createClient: () => ({ get: mockGet, getAll: mockGetAll }),
}));

import { findOrganizer, getOrganizer, getOrganizers, resolveOrganizerId } from "./reader.ts";

const RAY = {
  name: "Ray",
  slug: "ray",
  aliases: ["rayhan"],
  linear: "lin-uuid-ray",
  notion: "notion-uuid-ray",
  github: "rayhanadev",
};

const ALICE = {
  name: "Alice",
  slug: "alice",
  sentry: "sentry-id-alice",
};

const ALL_STORED = {
  organizer_100000000000000001: RAY,
  organizer_100000000000000002: ALICE,
  // Unrelated keys (e.g. hack-night's `version`) must be ignored.
  version: "6.17",
};

const SAMPLE_MAP = {
  "100000000000000001": RAY,
  "100000000000000002": ALICE,
};

beforeEach(() => {
  mockGet.mockReset();
  mockGetAll.mockReset();
});

describe("getOrganizers", () => {
  it("returns {} when Edge Config has no items", async () => {
    mockGetAll.mockResolvedValue(undefined);
    expect(await getOrganizers()).toEqual({});
  });

  it("ignores keys that don't match the organizer prefix", async () => {
    mockGetAll.mockResolvedValue({ version: "6.17", random: { foo: 1 } });
    expect(await getOrganizers()).toEqual({});
  });

  it("drops entries that fail schema validation but keeps valid ones", async () => {
    mockGetAll.mockResolvedValue({
      organizer_100000000000000001: RAY,
      organizer_broken: { name: 42 },
    });
    expect(await getOrganizers()).toEqual({ "100000000000000001": RAY });
  });

  it("returns the parsed map stripped of the prefix", async () => {
    mockGetAll.mockResolvedValue(ALL_STORED);
    expect(await getOrganizers()).toEqual(SAMPLE_MAP);
  });
});

describe("getOrganizer", () => {
  it("returns null when the key is missing", async () => {
    mockGet.mockResolvedValue(undefined);
    expect(await getOrganizer("100000000000000001")).toBeNull();
  });

  it("returns null when the stored value fails schema validation", async () => {
    mockGet.mockResolvedValue({ name: 42 });
    expect(await getOrganizer("100000000000000001")).toBeNull();
  });

  it("returns the parsed organizer when valid", async () => {
    mockGet.mockResolvedValue(RAY);
    expect(await getOrganizer("100000000000000001")).toEqual(RAY);
    expect(mockGet).toHaveBeenCalledWith("organizer_100000000000000001");
  });
});

describe("findOrganizer", () => {
  beforeEach(() => {
    mockGetAll.mockResolvedValue(ALL_STORED);
  });

  it("matches by Discord ID", async () => {
    expect(await findOrganizer("100000000000000001")).toEqual({
      ...RAY,
      discord: "100000000000000001",
    });
  });

  it("matches by slug case-insensitively and includes the Discord ID", async () => {
    const found = await findOrganizer("RAY");
    expect(found?.discord).toBe("100000000000000001");
    expect(found?.slug).toBe("ray");
  });

  it("matches by display name case-insensitively", async () => {
    const found = await findOrganizer("alice");
    expect(found?.discord).toBe("100000000000000002");
  });

  it("matches by alias", async () => {
    const found = await findOrganizer("Rayhan");
    expect(found?.discord).toBe("100000000000000001");
  });

  it("trims whitespace before matching", async () => {
    const found = await findOrganizer("  ray  ");
    expect(found?.discord).toBe("100000000000000001");
  });

  it("returns null for an empty query", async () => {
    expect(await findOrganizer("   ")).toBeNull();
  });

  it("returns null when no organizer matches", async () => {
    expect(await findOrganizer("nobody")).toBeNull();
  });
});

describe("resolveOrganizerId", () => {
  beforeEach(() => {
    mockGetAll.mockResolvedValue(ALL_STORED);
  });

  it("returns the Discord ID when platform is 'discord'", async () => {
    expect(await resolveOrganizerId("ray", "discord")).toBe("100000000000000001");
  });

  it("returns the platform field for a matched organizer", async () => {
    expect(await resolveOrganizerId("ray", "linear")).toBe("lin-uuid-ray");
    expect(await resolveOrganizerId("rayhan", "github")).toBe("rayhanadev");
  });

  it("returns null when the matched organizer lacks the requested platform", async () => {
    expect(await resolveOrganizerId("alice", "linear")).toBeNull();
  });

  it("returns null when no organizer matches", async () => {
    expect(await resolveOrganizerId("nobody", "linear")).toBeNull();
  });

  it("returns null for an empty query", async () => {
    expect(await resolveOrganizerId("  ", "linear")).toBeNull();
  });

  it("matches by Discord ID and resolves the field", async () => {
    expect(await resolveOrganizerId("100000000000000002", "sentry")).toBe("sentry-id-alice");
  });
});
