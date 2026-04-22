import { log } from "evlog";

import type { CreateShipInput, CreateShipResponse, DeleteShipResponse } from "./types";

const SHIPS_API_ORIGIN = "https://ships.purduehackers.com";

export class ShipsClient {
  constructor(private apiKey: string) {}

  private url(path: string): string {
    return `${SHIPS_API_ORIGIN}${path}`;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async createShip(input: CreateShipInput): Promise<CreateShipResponse> {
    const res = await fetch(this.url("/api/ships"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("ships", `POST /api/ships failed: ${res.status} ${text.slice(0, 200)}`);
      throw new Error(`Ships API ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    }

    return (await res.json()) as CreateShipResponse;
  }

  async deleteShipByMessageId(messageId: string): Promise<DeleteShipResponse> {
    const res = await fetch(this.url(`/api/ships/${encodeURIComponent(messageId)}`), {
      method: "DELETE",
      headers: this.headers(),
    });

    if (res.status === 404) {
      return { deleted: false, attachmentsRemoved: 0 };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn(
        "ships",
        `DELETE /api/ships/${messageId} failed: ${res.status} ${text.slice(0, 200)}`,
      );
      throw new Error(`Ships API ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    }

    const body = (await res.json()) as {
      ok?: boolean;
      id?: string;
      attachmentsRemoved?: number;
    };
    return {
      deleted: Boolean(body.ok),
      id: body.id,
      attachmentsRemoved: body.attachmentsRemoved ?? 0,
    };
  }
}
