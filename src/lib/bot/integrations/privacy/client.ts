import { log } from "evlog";

import type { PrivacyMode, PrivacyProject } from "./enums";
import type { UserPreferences } from "./types";

export class PrivacyClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("privacy", `${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
      throw new Error("Privacy API request failed");
    }

    return res.json() as Promise<T>;
  }

  async getPreferences(userId: string): Promise<UserPreferences> {
    return this.request("GET", `/preferences/${userId}`);
  }

  async setGlobalMode(userId: string, mode: PrivacyMode, reason?: string): Promise<void> {
    await this.request("PUT", `/preferences/${userId}`, { mode, reason });
  }

  async setProjectOverride(
    userId: string,
    project: PrivacyProject,
    mode: PrivacyMode,
    reason?: string,
  ): Promise<void> {
    await this.request("PUT", `/preferences/${userId}/${project}`, { mode, reason });
  }

  async resetPreferences(userId: string): Promise<void> {
    await this.request("DELETE", `/preferences/${userId}`);
  }

  async removeProjectOverride(userId: string, project: PrivacyProject): Promise<void> {
    await this.request("DELETE", `/preferences/${userId}/${project}`);
  }
}
