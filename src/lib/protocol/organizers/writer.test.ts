import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, patchSpy } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  patchSpy: vi.fn(),
}));

vi.mock("@vercel/edge-config", () => ({
  createClient: () => ({ get: mockGet }),
}));

vi.mock("@vercel/sdk", () => ({
  Vercel: class {
    edgeConfig = { patchEdgeConfigItems: patchSpy };
  },
}));

import { upsertOrganizer } from "./writer.ts";

const RAY_ID = "100000000000000001";
const RAY_KEY = `organizer_${RAY_ID}`;

beforeEach(() => {
  mockGet.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue(undefined);
});

describe("upsertOrganizer — create and merge", () => {
  it("creates a new entry when none exists", async () => {
    mockGet.mockResolvedValue(undefined);
    const result = await upsertOrganizer(RAY_ID, {
      name: "Ray",
      slug: "Ray",
      linear: "lin-1",
      github: "rayhanadev",
    });
    expect(result.organizer).toEqual({
      name: "Ray",
      slug: "ray",
      aliases: undefined,
      linear: "lin-1",
      github: "rayhanadev",
    });
    expect(result.set.sort()).toEqual(["github", "linear"]);
    expect(result.cleared).toEqual([]);
    expect(mockGet).toHaveBeenCalledWith(RAY_KEY);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    const call = patchSpy.mock.calls[0][0];
    expect(call.requestBody.items[0]).toMatchObject({ operation: "upsert", key: RAY_KEY });
    expect(call.requestBody.items[0].value.linear).toBe("lin-1");
  });

  it("preserves existing fields when patch omits them", async () => {
    mockGet.mockResolvedValue({
      name: "Ray",
      slug: "ray",
      linear: "lin-existing",
      github: "rayhanadev",
    });
    const result = await upsertOrganizer(RAY_ID, { notion: "notion-new" });
    expect(result.organizer).toMatchObject({
      linear: "lin-existing",
      github: "rayhanadev",
      notion: "notion-new",
    });
    expect(result.set).toEqual(["notion"]);
  });

  it("preserves aliases when the patch omits them", async () => {
    mockGet.mockResolvedValue({ name: "Ray", slug: "ray", aliases: ["rayhan"] });
    const result = await upsertOrganizer(RAY_ID, { linear: "lin-1" });
    expect(result.organizer.aliases).toEqual(["rayhan"]);
  });

  it("writes only the target user's key (never touches other organizers)", async () => {
    mockGet.mockResolvedValue(undefined);
    await upsertOrganizer(RAY_ID, { name: "Ray", slug: "ray" });
    const items = patchSpy.mock.calls[0][0].requestBody.items;
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe(RAY_KEY);
  });
});

describe("upsertOrganizer — field operations", () => {
  it("clears a field when patch passes an empty string", async () => {
    mockGet.mockResolvedValue({ name: "Ray", slug: "ray", linear: "lin-existing" });
    const result = await upsertOrganizer(RAY_ID, { linear: "" });
    expect(result.organizer.linear).toBeUndefined();
    expect(result.cleared).toEqual(["linear"]);
    expect(result.set).toEqual([]);
    const call = patchSpy.mock.calls[0][0];
    expect(call.requestBody.items[0].value.linear).toBeUndefined();
  });

  it("does not report clear when the field was already absent", async () => {
    mockGet.mockResolvedValue({ name: "Ray", slug: "ray" });
    const result = await upsertOrganizer(RAY_ID, { linear: "" });
    expect(result.cleared).toEqual([]);
  });

  it("does not report set when the value is unchanged", async () => {
    mockGet.mockResolvedValue({ name: "Ray", slug: "ray", linear: "lin-1" });
    const result = await upsertOrganizer(RAY_ID, { linear: "lin-1" });
    expect(result.set).toEqual([]);
  });

  it("defaults name and slug to the Discord ID when no value is available", async () => {
    mockGet.mockResolvedValue(undefined);
    const result = await upsertOrganizer(RAY_ID, {});
    expect(result.organizer.name).toBe(RAY_ID);
    expect(result.organizer.slug).toBe(RAY_ID);
  });

  it("lowercases slug on write", async () => {
    mockGet.mockResolvedValue(undefined);
    const result = await upsertOrganizer(RAY_ID, { name: "Ray", slug: "RAY" });
    expect(result.organizer.slug).toBe("ray");
  });
});
