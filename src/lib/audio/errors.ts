export class OggSplitParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OggSplitParseError";
  }
}

export class OggSplitNoAudioError extends Error {
  constructor() {
    super("OGG stream contains no audio pages");
    this.name = "OggSplitNoAudioError";
  }
}

export class OggSplitTooLargeError extends Error {
  constructor(
    public readonly chunks: number,
    public readonly maxChunks: number,
  ) {
    super("OGG stream requires " + chunks + " chunks, exceeding max " + maxChunks);
    this.name = "OggSplitTooLargeError";
  }
}
