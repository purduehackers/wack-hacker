/**
 * @fileoverview Splitting an Ogg Opus stream into smaller, still-valid Ogg
 * Opus streams.
 *
 * Whisper rejects uploads past a size limit, and Discord voice messages can
 * exceed it. Cutting the bytes at an arbitrary offset produces something no
 * decoder will accept. Each piece therefore has to be a complete stream in
 * its own right. That means three things per chunk:
 *
 * 1. The chunk replicates the two header pages (OpusHead, OpusTags).
 * 2. The split renumbers page sequence numbers from zero.
 * 3. Only the last page carries the end-of-stream flag. Every other page
 *    loses it.
 *
 * And because all three edit the page header in place, the splitter recomputes
 * every page's CRC. The decoder silently discards a page whose checksum no
 * longer matches its bytes, losing audio.
 */

import { InvalidInput, messageOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import CodecParser from "codec-parser";
import type { OggPage } from "codec-parser";

/** Byte offsets into an Ogg page header, per RFC 3533. */
const OFFSET_HEADER_TYPE = 5;
const OFFSET_PAGE_SEQUENCE = 18;
const OFFSET_CHECKSUM = 22;
const EOS_FLAG = 0x04;

const DEFAULT_TARGET_BYTES = 20 * 1024 * 1024;

/** A ceiling on pieces, so a pathological file cannot fan out into hundreds. */
const DEFAULT_MAX_CHUNKS = 10;

const POLYNOMIAL = 0x04c1_1db7;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = (index << 24) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x8000_0000) !== 0 ? ((value << 1) ^ POLYNOMIAL) >>> 0 : (value << 1) >>> 0;
    }
    table[index] = value;
  }
  return table;
})();

/**
 * Ogg's CRC-32 per RFC 3533.
 *
 * Not the common CRC-32: same polynomial, but no input or output reflection and
 * no final xor. Using a stock implementation here produces checksums every
 * decoder rejects.
 */
function oggCrc32(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    const index = ((crc >>> 24) ^ byte) & 0xff;
    crc = (((crc << 8) >>> 0) ^ (CRC_TABLE[index] ?? 0)) >>> 0;
  }
  return crc >>> 0;
}

function writeU32LE(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
}

export interface OggSplitOptions {
  readonly targetBytes?: number;
}

/** Assembles one self-contained stream from the shared headers plus a group. */
function emitChunk(headerPages: readonly OggPage[], audioGroup: readonly OggPage[]): Uint8Array {
  const assembledPages = [...headerPages, ...audioGroup];
  const total = assembledPages.reduce((sum, encodedPage) => sum + encodedPage.rawData.length, 0);
  const chunk = new Uint8Array(total);

  const slots: { offset: number; length: number }[] = [];
  let offset = 0;
  for (const packetPage of assembledPages) {
    chunk.set(packetPage.rawData, offset);
    slots.push({ offset, length: packetPage.rawData.length });
    offset += packetPage.rawData.length;
  }

  for (const [index, slot] of slots.entries()) {
    const isLast = index === slots.length - 1;

    // Exactly one page may claim end-of-stream, and it must be this chunk's
    // last — not whichever page happened to carry the flag in the original.
    const headerType = chunk[slot.offset + OFFSET_HEADER_TYPE] ?? 0;
    chunk[slot.offset + OFFSET_HEADER_TYPE] = isLast
      ? headerType | EOS_FLAG
      : headerType & ~EOS_FLAG;

    writeU32LE(chunk, slot.offset + OFFSET_PAGE_SEQUENCE, index);

    // The checksum field must read as zero while the CRC sums the page.
    writeU32LE(chunk, slot.offset + OFFSET_CHECKSUM, 0);
    const crc = oggCrc32(chunk.subarray(slot.offset, slot.offset + slot.length));
    writeU32LE(chunk, slot.offset + OFFSET_CHECKSUM, crc);
  }

  return chunk;
}

/**
 * Splits into streams that each fit `targetBytes`.
 *
 * A stream already under the target comes back unchanged, so the caller can
 * treat the single-chunk case exactly like the many-chunk one.
 */
export function splitOggOpus(
  buffer: Uint8Array,
  options?: OggSplitOptions,
): Result<readonly Uint8Array[], InvalidInput> {
  const targetBytes = options?.targetBytes ?? DEFAULT_TARGET_BYTES;

  if (buffer.byteLength <= targetBytes) return Result.ok([buffer]);

  const parsed = Result.try({
    try: () => new CodecParser<OggPage>("audio/ogg").parseAll(buffer),
    catch: (cause) =>
      new InvalidInput({
        subject: "ogg opus stream",
        issues: [messageOf(cause)],
      }),
  });
  if (Result.isError(parsed)) return parsed;

  const pages = parsed.value;
  if (pages.length < 2) {
    return Result.err(
      new InvalidInput({
        subject: "ogg opus stream",
        issues: [`expected at least 2 header pages, found ${pages.length}`],
      }),
    );
  }

  const headerPages = pages.slice(0, 2);
  const audioPages = pages.slice(2);
  if (audioPages.length === 0) {
    return Result.err(new InvalidInput({ subject: "ogg opus stream", issues: ["no audio pages"] }));
  }

  const headerBytes = headerPages.reduce((sum, value) => sum + value.rawData.length, 0);
  const audioBudget = targetBytes - headerBytes;
  if (audioBudget <= 0) {
    return Result.err(
      new InvalidInput({
        subject: "ogg opus stream",
        issues: [`headers (${headerBytes}B) do not fit the ${targetBytes}B target`],
      }),
    );
  }

  // Pages are indivisible: a group takes whole pages until the next would
  // overflow the budget.
  const groups: OggPage[][] = [];
  let current: OggPage[] = [];
  let currentBytes = 0;

  for (const packetPage of audioPages) {
    if (currentBytes + packetPage.rawData.length > audioBudget && current.length > 0) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(packetPage);
    currentBytes += packetPage.rawData.length;
  }
  groups.push(current);

  if (groups.length > DEFAULT_MAX_CHUNKS) {
    return Result.err(
      new InvalidInput({
        subject: "ogg opus stream",
        issues: [`would split into ${groups.length} chunks, over the ${DEFAULT_MAX_CHUNKS} limit`],
      }),
    );
  }

  return Result.ok(groups.map((pages) => emitChunk(headerPages, pages)));
}
