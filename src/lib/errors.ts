/** Error with structured metadata for observability. */
export class MetaError extends Error {
  constructor(
    message: string,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MetaError";
  }
}
