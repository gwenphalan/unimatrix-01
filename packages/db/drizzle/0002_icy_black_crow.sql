CREATE TABLE `content_assets` (
	`hash` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`original_filename` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `content_assets_created_at_idx` ON `content_assets` (`created_at`);--> statement-breakpoint
CREATE TABLE `content_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`description` text,
	`body` text NOT NULL,
	`publication_state` text DEFAULT 'draft' NOT NULL,
	`published_at` text,
	`featured` integer DEFAULT false NOT NULL,
	`project_status` text,
	`repo_url` text,
	`live_url` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_posts_type_slug_unique` ON `content_posts` (`type`,`slug`);--> statement-breakpoint
CREATE INDEX `content_posts_listing_idx` ON `content_posts` (`type`,`publication_state`,`published_at`);