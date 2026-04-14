import type { PrivacyMode } from "./enums";

export interface UserPreferences {
  user_id: string;
  mode: PrivacyMode;
  overrides: Record<string, PrivacyMode>;
}
