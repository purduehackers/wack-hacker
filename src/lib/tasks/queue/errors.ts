export class UnknownTaskError extends Error {
  constructor(public readonly task: string) {
    super("Unknown task: " + task);
    this.name = "UnknownTaskError";
  }
}

export class InvalidTaskPayloadError extends Error {
  constructor(
    public readonly task: string,
    public override readonly cause: unknown,
  ) {
    super("Invalid payload for task: " + task);
    this.name = "InvalidTaskPayloadError";
  }
}
