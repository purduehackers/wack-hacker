/** Redis authority for the currently active bot Sandbox generation. */
export const BOT_ACTIVE_GENERATION_KEY = "wack:bot-sandbox:active:v1";

export interface ActiveBotGeneration {
  readonly version: 1;
  readonly generation: number;
  readonly sandboxName: string;
  readonly commandId: string;
  /** The requested immutable image reference, including its sha256 digest. */
  readonly image: string;
  readonly healthUrl: string;
  readonly activatedAt: string;
  readonly expiresAt: string;
}
