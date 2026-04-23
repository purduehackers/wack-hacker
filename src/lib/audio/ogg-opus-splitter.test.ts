import type { OggPage } from "codec-parser";

import CodecParser from "codec-parser";
import { describe, it, expect } from "vitest";

import { oggCrc32 } from "./crc32-ogg";
import { OggSplitNoAudioError, OggSplitParseError, OggSplitTooLargeError } from "./errors";
import { splitOggOpus } from "./ogg-opus-splitter";

const EOS_FLAG = 0x04;
const BOS_FLAG = 0x02;

/** Build a single OGG page with the given body and header fields. */
function makePage(opts: {
  headerType: number;
  granulePosition: bigint;
  serialNumber: number;
  sequenceNumber: number;
  body: Uint8Array;
}): Uint8Array {
  const segments: number[] = [];
  let remaining = opts.body.length;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);
  const numSegments = segments.length;
  if (numSegments > 255) {
    throw new Error("body too large for a single page");
  }

  const pageLen = 27 + numSegments + opts.body.length;
  const page = new Uint8Array(pageLen);
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength);

  page.set([0x4f, 0x67, 0x67, 0x53], 0);
  page[4] = 0;
  page[5] = opts.headerType;
  view.setBigInt64(6, opts.granulePosition, true);
  view.setUint32(14, opts.serialNumber, true);
  view.setUint32(18, opts.sequenceNumber, true);
  view.setUint32(22, 0, true);
  page[26] = numSegments;
  for (let i = 0; i < numSegments; i++) {
    page[27 + i] = segments[i]!;
  }
  page.set(opts.body, 27 + numSegments);

  view.setUint32(22, oggCrc32(page), true);
  return page;
}

/** Minimal valid OpusHead identification body (19 bytes). */
function opusHeadBody(): Uint8Array {
  const body = new Uint8Array(19);
  const view = new DataView(body.buffer);
  body.set(new TextEncoder().encode("OpusHead"), 0);
  body[8] = 1;
  body[9] = 1;
  view.setUint16(10, 0, true);
  view.setUint32(12, 48_000, true);
  view.setInt16(16, 0, true);
  body[18] = 0;
  return body;
}

/** Minimal valid OpusTags comment body (16 bytes: magic + empty vendor + 0 comments). */
function opusTagsBody(): Uint8Array {
  const body = new Uint8Array(16);
  body.set(new TextEncoder().encode("OpusTags"), 0);
  return body;
}

function audioBody(size: number, seed: number): Uint8Array {
  const body = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    body[i] = (seed + i) & 0xff;
  }
  return body;
}

function buildStream(audioPageSizes: readonly number[]): {
  buffer: Uint8Array;
  headerBytes: number;
} {
  const serial = 0x1234_5678;
  const opusHead = makePage({
    headerType: BOS_FLAG,
    granulePosition: 0n,
    serialNumber: serial,
    sequenceNumber: 0,
    body: opusHeadBody(),
  });
  const opusTags = makePage({
    headerType: 0,
    granulePosition: 0n,
    serialNumber: serial,
    sequenceNumber: 1,
    body: opusTagsBody(),
  });

  const allPages: Uint8Array[] = [opusHead, opusTags];
  let granule = 0n;
  for (let i = 0; i < audioPageSizes.length; i++) {
    granule += 960n;
    const isLast = i === audioPageSizes.length - 1;
    allPages.push(
      makePage({
        headerType: isLast ? EOS_FLAG : 0,
        granulePosition: granule,
        serialNumber: serial,
        sequenceNumber: i + 2,
        body: audioBody(audioPageSizes[i]!, i),
      }),
    );
  }

  const total = allPages.reduce((sum, p) => sum + p.length, 0);
  const buffer = new Uint8Array(total);
  let off = 0;
  for (const serialized of allPages) {
    buffer.set(serialized, off);
    off += serialized.length;
  }

  return { buffer, headerBytes: opusHead.length + opusTags.length };
}

function parsePages(buf: Uint8Array): OggPage[] {
  return new CodecParser<OggPage>("audio/ogg").parseAll(buf);
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]! |
      (buf[offset + 1]! << 8) |
      (buf[offset + 2]! << 16) |
      (buf[offset + 3]! << 24)) >>>
    0
  );
}

describe("splitOggOpus bypass path", () => {
  it("returns the input unchanged when buffer fits under targetBytes", () => {
    const { buffer } = buildStream([200, 200, 200]);
    const result = splitOggOpus(buffer, { targetBytes: 10 * 1024 });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(buffer);
    expect(result.headerBytes).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("uses default 20 MB target when called without options", () => {
    const { buffer } = buildStream([200, 200, 200]);
    const result = splitOggOpus(buffer);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(buffer);
  });

  it("falls back to DEFAULT_MAX_CHUNKS when maxChunks option is omitted", () => {
    const { buffer, headerBytes } = buildStream([400, 400, 400, 400, 400, 400]);
    const result = splitOggOpus(buffer, { targetBytes: headerBytes + 900 });
    expect(result.chunks.length).toBeGreaterThan(1);
  });
});

describe("splitOggOpus chunking behavior", () => {
  const audioSizes = [400, 400, 400, 400, 400, 400];

  it("splits a multi-page stream into multiple chunks under a small target", () => {
    const { buffer, headerBytes } = buildStream(audioSizes);
    const targetBytes = headerBytes + 900;
    const result = splitOggOpus(buffer, { targetBytes });
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.headerBytes).toBe(headerBytes);
    expect(result.totalPages).toBe(2 + audioSizes.length);
    for (const chunk of result.chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(targetBytes);
    }
  });

  it("each emitted chunk starts with OpusHead + OpusTags and re-parses cleanly", () => {
    const { buffer, headerBytes } = buildStream(audioSizes);
    const result = splitOggOpus(buffer, { targetBytes: headerBytes + 900 });
    for (const chunk of result.chunks) {
      const parsed = parsePages(chunk);
      expect(parsed.length).toBeGreaterThanOrEqual(3);
      const textDecoder = new TextDecoder();
      expect(textDecoder.decode(parsed[0]!.rawData.subarray(28, 28 + 8))).toBe("OpusHead");
      expect(textDecoder.decode(parsed[1]!.rawData.subarray(28, 28 + 8))).toBe("OpusTags");
    }
  });

  it("renumbers pageSequenceNumber contiguously from 0 within each chunk", () => {
    const { buffer, headerBytes } = buildStream(audioSizes);
    const result = splitOggOpus(buffer, { targetBytes: headerBytes + 900 });
    for (const chunk of result.chunks) {
      const parsed = parsePages(chunk);
      for (let i = 0; i < parsed.length; i++) {
        expect(parsed[i]!.pageSequenceNumber).toBe(i);
      }
    }
  });

  it("sets EOS on last page of every chunk and clears it elsewhere", () => {
    const { buffer, headerBytes } = buildStream(audioSizes);
    const result = splitOggOpus(buffer, { targetBytes: headerBytes + 900 });
    for (const chunk of result.chunks) {
      const parsed = parsePages(chunk);
      for (let i = 0; i < parsed.length; i++) {
        const headerType = parsed[i]!.rawData[5]!;
        const hasEos = (headerType & EOS_FLAG) !== 0;
        if (i === parsed.length - 1) {
          expect(hasEos).toBe(true);
        } else {
          expect(hasEos).toBe(false);
        }
      }
    }
  });

  it("recomputes valid CRC checksums on every rewritten page", () => {
    const { buffer, headerBytes } = buildStream(audioSizes);
    const result = splitOggOpus(buffer, { targetBytes: headerBytes + 900 });
    for (const chunk of result.chunks) {
      const parsed = parsePages(chunk);
      for (const entry of parsed) {
        const storedCrc = readU32LE(entry.rawData, 22);
        const copy = new Uint8Array(entry.rawData);
        copy[22] = 0;
        copy[23] = 0;
        copy[24] = 0;
        copy[25] = 0;
        expect(oggCrc32(copy)).toBe(storedCrc);
      }
    }
  });
});

describe("splitOggOpus error cases", () => {
  it("throws OggSplitNoAudioError when stream has only header pages", () => {
    const { buffer } = buildStream([]);
    expect(() => splitOggOpus(buffer, { targetBytes: 1 })).toThrow(OggSplitNoAudioError);
  });

  it("throws OggSplitTooLargeError when splitting would exceed maxChunks", () => {
    const { buffer, headerBytes } = buildStream([400, 400, 400, 400, 400, 400]);
    expect(() => splitOggOpus(buffer, { targetBytes: headerBytes + 500, maxChunks: 2 })).toThrow(
      OggSplitTooLargeError,
    );
  });

  it("throws OggSplitParseError when header pages do not fit in target", () => {
    const { buffer, headerBytes } = buildStream([400]);
    expect(() => splitOggOpus(buffer, { targetBytes: headerBytes - 1 })).toThrow(
      OggSplitParseError,
    );
  });

  it("throws OggSplitParseError on a garbage input too small to contain a page", () => {
    const garbage = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const bigger = new Uint8Array(200);
    bigger.set(garbage);
    expect(() => splitOggOpus(bigger, { targetBytes: 100 })).toThrow(OggSplitParseError);
  });
});
