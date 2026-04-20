CREATE TABLE `hack_night_images` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`filename` text NOT NULL,
	`uploaded_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`discord_message_id` text NOT NULL,
	`discord_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hack_night_images_slug_filename_uq` ON `hack_night_images` (`event_slug`,`filename`);--> statement-breakpoint
CREATE INDEX `hack_night_images_slug_idx` ON `hack_night_images` (`event_slug`);--> statement-breakpoint
CREATE INDEX `hack_night_images_message_idx` ON `hack_night_images` (`discord_message_id`);