import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  cursorPaginationInputShape,
  pageField,
  pageSizeField,
  paginationInputShape,
  perPageField,
  startCursorField,
} from "./constants";

describe("perPageField", () => {
  const schema = z.object({ per_page: perPageField });

  it("accepts undefined", () => {
    expect(schema.parse({})).toEqual({});
  });

  it("accepts 1 to 100", () => {
    expect(schema.parse({ per_page: 50 }).per_page).toBe(50);
    expect(schema.parse({ per_page: 100 }).per_page).toBe(100);
    expect(schema.parse({ per_page: 1 }).per_page).toBe(1);
  });

  it("rejects 0, negatives, and >100", () => {
    expect(() => schema.parse({ per_page: 0 })).toThrow();
    expect(() => schema.parse({ per_page: -1 })).toThrow();
    expect(() => schema.parse({ per_page: 101 })).toThrow();
  });

  it("rejects non-integers", () => {
    expect(() => schema.parse({ per_page: 1.5 })).toThrow();
  });
});

describe("pageField", () => {
  const schema = z.object({ page: pageField });

  it("accepts undefined and positive ints", () => {
    expect(schema.parse({}).page).toBeUndefined();
    expect(schema.parse({ page: 1 }).page).toBe(1);
    expect(schema.parse({ page: 9999 }).page).toBe(9999);
  });

  it("rejects 0 and negatives", () => {
    expect(() => schema.parse({ page: 0 })).toThrow();
    expect(() => schema.parse({ page: -1 })).toThrow();
  });
});

describe("paginationInputShape", () => {
  const schema = z.object(paginationInputShape);

  it("is spreadable and validates both fields together", () => {
    expect(schema.parse({ per_page: 30, page: 2 })).toEqual({ per_page: 30, page: 2 });
    expect(schema.parse({})).toEqual({});
  });
});

describe("cursorPaginationInputShape", () => {
  const schema = z.object(cursorPaginationInputShape);

  it("accepts page_size and start_cursor", () => {
    expect(schema.parse({ page_size: 50, start_cursor: "abc" })).toEqual({
      page_size: 50,
      start_cursor: "abc",
    });
  });

  it("rejects page_size over 100", () => {
    expect(() => schema.parse({ page_size: 101 })).toThrow();
  });
});

describe("pageSizeField + startCursorField", () => {
  it("pageSizeField bounds to 1..100 ints", () => {
    const schema = z.object({ page_size: pageSizeField });
    expect(schema.parse({ page_size: 1 }).page_size).toBe(1);
    expect(() => schema.parse({ page_size: 0 })).toThrow();
    expect(() => schema.parse({ page_size: 101 })).toThrow();
  });

  it("startCursorField is optional string", () => {
    const schema = z.object({ cursor: startCursorField });
    expect(schema.parse({}).cursor).toBeUndefined();
    expect(schema.parse({ cursor: "x" }).cursor).toBe("x");
  });
});
