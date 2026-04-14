export interface ImageMetadata {
  filename: string;
  uploadedAt: string;
  discordMessageId: string;
  discordUserId: string;
}

export interface EventIndex {
  eventSlug: string;
  lastUpdated: string;
  images: ImageMetadata[];
}
