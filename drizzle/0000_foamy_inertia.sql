CREATE TABLE `shopping_cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`asin` text NOT NULL,
	`title` text NOT NULL,
	`price` real NOT NULL,
	`quantity` integer NOT NULL,
	`added_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `shopping_carts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_cart_items_cart_asin_uq` ON `shopping_cart_items` (`cart_id`,`asin`);--> statement-breakpoint
CREATE TABLE `shopping_carts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
