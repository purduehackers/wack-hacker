CREATE TABLE `badge_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`width_in` real NOT NULL,
	`height_in` real NOT NULL,
	`thickness_mm` real NOT NULL,
	`quantity` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "badge_stock_nonnegative" CHECK("badge_stock"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE `badge_stock_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`operation` text NOT NULL,
	`before` integer NOT NULL,
	`after` integer NOT NULL,
	`actor_id` text NOT NULL,
	`username` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `badge_stock_changes_item` ON `badge_stock_changes` (`item_id`,`created_at`);