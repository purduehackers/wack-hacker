export interface HackNightImage {
  id: number | string;
  filename: string;
  url: string;
  discordMessageId: string;
  discordUserId: string;
  uploadedAt: string;
}

export interface UploadHackNightImageInput {
  url: string;
  slug: string;
  discordMessageId: string;
  discordUserId: string;
  filename: string;
  contentType: string;
}
