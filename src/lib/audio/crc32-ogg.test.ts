import { describe, it, expect } from "vitest";

import { oggCrc32 } from "./crc32-ogg";

describe("oggCrc32", () => {
  it("returns 0 for empty input", () => {
    expect(oggCrc32(new Uint8Array(0))).toBe(0);
  });

  it("returns 0 for any run of zero bytes (init=0, no xor-out)", () => {
    expect(oggCrc32(new Uint8Array(1))).toBe(0);
    expect(oggCrc32(new Uint8Array(16))).toBe(0);
    expect(oggCrc32(new Uint8Array(1000))).toBe(0);
  });

  it("matches the libogg CRC table entry for byte 0x01", () => {
    // libogg's lookup table is the single-byte-from-init-0 CRC: table[b] = crc32([b]).
    // table[1] = 0x04C11DB7 (first nonzero entry, known from the libogg reference).
    expect(oggCrc32(new Uint8Array([0x01]))).toBe(0x04c1_1db7);
  });

  it("matches the libogg CRC table entry for byte 0x02", () => {
    // table[2] = 0x09823B6E (known from the libogg reference).
    expect(oggCrc32(new Uint8Array([0x02]))).toBe(0x0982_3b6e);
  });

  it("matches the libogg CRC table entry for byte 0xFF", () => {
    // table[0xFF] = 0xB1F740B4 (known from the libogg reference).
    expect(oggCrc32(new Uint8Array([0xff]))).toBe(0xb1f7_40b4);
  });

  it("returns a non-negative 32-bit unsigned integer", () => {
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const crc = oggCrc32(data);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffff_ffff);
  });

  it("is deterministic for the same input", () => {
    const data = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
    expect(oggCrc32(data)).toBe(oggCrc32(data));
  });

  it("produces different values for different inputs", () => {
    const a = oggCrc32(new Uint8Array([0x01]));
    const b = oggCrc32(new Uint8Array([0x02]));
    expect(a).not.toBe(b);
  });
});
