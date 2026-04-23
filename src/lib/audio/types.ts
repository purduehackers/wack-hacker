export interface OggSplitOptions {
  readonly targetBytes?: number;
  readonly maxChunks?: number;
}

export interface OggSplitResult {
  readonly chunks: readonly Uint8Array[];
  readonly headerBytes: number;
  readonly totalPages: number;
}
