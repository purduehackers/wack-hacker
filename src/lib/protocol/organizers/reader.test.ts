import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("@vercel/edge-config", () => ({
  createClient: () => ({ get: mockGet }),
}));

import { getOrganizers, findOrganizer, resolveOrganizerId } from "./reader.ts";

const SAMPLE = {
  "100000000000000001": {
    name: "Ray",
    slug: "ray",
    aliases: ["rayhan"],
    linear: "lin-uuid-ray",
    notion: "notion-uuid-ray",
    github: "rayhanadev",
  },
  "100000000000000002": {
    name: "Alice",
    slug: "alice",
    sentry: "sentry-id-alice",
  },
};

beforeEach(() => {
  mockGet.mockReset();
});

describe("getOrganizers", () => {
  it("returns {} when the key is missing", async () => {
    mockGet.mockResolvedValue(undefined);
    expect(await getOrganizers()).toEqual({});
  });

  it("returns {} when the key is null", async () => {
    mockGet.mockResolvedValue(null);
    expect(await getOrganizers()).toEqual({});
  });

  it("returns {} when the stored value fails schema validation", async () => {
    mockGet.mockResolvedValue({ "123": { name: 42 } });
    expect(await getOrganizers()).toEqual({});
  });

  it("returns the parsed map when valid", async () => {
    mockGet.mockResolvedValue(SAMPLE);
    expect(await getOrganizers()).toEqual(SAMPLE);
  });
});

describe("findOrganizer", () => {
  beforeEach(() => {
    mockGet.mockResolvedValue(SAMPLE);
  });

  it("matches by Discord ID (map key)", async () => {
    expect(await findOrganizer("100000000000000001")).toEqual({
      ...SAMPLE["100000000000000001"],
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
    mockGet.mockResolvedValue(SAMPLE);
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
