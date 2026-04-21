export interface PayloadMedia {
  id: number;
  url: string;
  filename: string;
  mimeType: string;
  filesize: number;
  width?: number | null;
  height?: number | null;
  alt?: string;
  batchId?: string | null;
  discordMessageId?: string | null;
  discordUserId?: string | null;
  source?: "manual" | "hack-night";
  createdAt: string;
  updatedAt: string;
}

export interface PayloadListResult<T> {
  docs: T[];
  totalDocs: number;
  limit: number;
  page?: number;
  totalPages?: number;
  hasNextPage: boolean;
}

export interface MediaUploadInput {
  buffer: Buffer | Uint8Array;
  filename: string;
  contentType: string;
  alt: string;
  batchId?: string;
  discordMessageId?: string;
  discordUserId?: string;
  source?: "manual" | "hack-night";
}
