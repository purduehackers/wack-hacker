const POLYNOMIAL = 0x04c1_1db7;

const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = (i << 24) >>> 0;
    for (let b = 0; b < 8; b++) {
      c = (c & 0x8000_0000) !== 0 ? ((c << 1) ^ POLYNOMIAL) >>> 0 : (c << 1) >>> 0;
    }
    t[i] = c;
  }
  return t;
})();

/** OGG CRC-32 per RFC 3533: poly 0x04C11DB7, init 0, no reflection, no xor-out. */
export function oggCrc32(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    const idx = ((crc >>> 24) ^ byte) & 0xff;
    crc = (((crc << 8) >>> 0) ^ TABLE[idx]!) >>> 0;
  }
  return crc >>> 0;
}
