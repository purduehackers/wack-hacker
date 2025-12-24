ALTER TABLE `commit_overflow_profiles` ADD `is_private` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `commits` ADD `is_private` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `commits` ADD `is_explicitly_private` integer DEFAULT 0 NOT NULL;