CREATE TABLE `badge_stock_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`state` text NOT NULL,
	`commit` text,
	`created_at` integer NOT NULL
);
