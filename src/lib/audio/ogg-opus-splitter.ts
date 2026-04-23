import type { OggPage } from "codec-parser";

import CodecParser from "codec-parser";

import type { OggSplitOptions, OggSplitResult } from "./types.ts";

import { oggCrc32 } from "./crc32-ogg.ts";
import { OggSplitNoAudioError, OggSplitParseError, OggSplitTooLargeError } from "./errors.ts";

const DEFAULT_TARGET_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_CHUNKS = 10;

const OFFSET_HEADER_TYPE = 5;
const OFFSET_PAGE_SEQUENCE = 18;
const OFFSET_CHECKSUM = 22;
const EOS_FLAG = 0x04;

/**
 * Split an OGG Opus byte stream into multiple valid OGG Opus streams, each
 * below `targetBytes`. Header pages (OpusHead + OpusTags) are replicated into
 * every emitted chunk, `pageSequenceNumber` is renumbered, and CRC-32
 * checksums are recomputed for each rewritten page.
 */
export function splitOggOpus(buffer: Uint8Array, options?: OggSplitOptions): OggSplitResult {
  const targetBytes = options?.targetBytes ?? DEFAULT_TARGET_BYTES;
  const maxChunks = options?.maxChunks ?? DEFAULT_MAX_CHUNKS;

  if (buffer.byteLength <= targetBytes) {
    return { chunks: [buffer], headerBytes: 0, totalPages: 0 };
  }

  const pages: OggPage[] = new CodecParser<OggPage>("audio/ogg").parseAll(buffer);

  if (pages.length < 2) {
    throw new OggSplitParseError("Expected at least 2 header pages, got " + pages.length);
  }

  const headerPages = pages.slice(0, 2);
  const audioPages = pages.slice(2);
  if (audioPages.length === 0) {
    throw new OggSplitNoAudioError();
  }

  const headerBytes = headerPages[0]!.rawData.length + headerPages[1]!.rawData.length;
  const audioBudget = targetBytes - headerBytes;
  if (audioBudget <= 0) {
    throw new OggSplitParseError(
      "Header pages (" + headerBytes + "B) do not fit in target (" + targetBytes + "B)",
    );
  }

  // audioPages is non-empty (guarded above) and every loop iteration pushes
  // onto `current`, so post-loop `current` always has ≥1 page to emit.
  const groups: OggPage[][] = [];
  let current: OggPage[] = [];
  let currentBytes = 0;
  for (const audio of audioPages) {
    const pageLen = audio.rawData.length;
    if (currentBytes + pageLen > audioBudget && current.length > 0) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(audio);
    currentBytes += pageLen;
  }
  groups.push(current);

  if (groups.length > maxChunks) {
    throw new OggSplitTooLargeError(groups.length, maxChunks);
  }

  const chunks: Uint8Array[] = groups.map((pagesInGroup) => emitChunk(headerPages, pagesInGroup));

  return { chunks, headerBytes, totalPages: pages.length };
}

function emitChunk(headerPages: OggPage[], audioGroup: OggPage[]): Uint8Array {
  const groupBytes = audioGroup.reduce((sum, p) => sum + p.rawData.length, 0);
  const headerBytes = headerPages.reduce((sum, p) => sum + p.rawData.length, 0);
  const chunk = new Uint8Array(headerBytes + groupBytes);

  const pageSlots: Array<{ offset: number; length: number }> = [];
  let off = 0;
  for (const header of headerPages) {
    chunk.set(header.rawData, off);
    pageSlots.push({ offset: off, length: header.rawData.length });
    off += header.rawData.length;
  }
  for (const audio of audioGroup) {
    chunk.set(audio.rawData, off);
    pageSlots.push({ offset: off, length: audio.rawData.length });
    off += audio.rawData.length;
  }

  const lastIdx = pageSlots.length - 1;
  for (let i = 0; i < pageSlots.length; i++) {
    const slot = pageSlots[i]!;
    const isLast = i === lastIdx;

    const headerType = chunk[slot.offset + OFFSET_HEADER_TYPE]!;
    chunk[slot.offset + OFFSET_HEADER_TYPE] = isLast
      ? headerType | EOS_FLAG
      : headerType & ~EOS_FLAG;

    writeU32LE(chunk, slot.offset + OFFSET_PAGE_SEQUENCE, i);
    writeU32LE(chunk, slot.offset + OFFSET_CHECKSUM, 0);

    const crc = oggCrc32(chunk.subarray(slot.offset, slot.offset + slot.length));
    writeU32LE(chunk, slot.offset + OFFSET_CHECKSUM, crc);
  }

  return chunk;
}

function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}
