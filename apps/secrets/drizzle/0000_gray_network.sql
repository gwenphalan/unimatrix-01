CREATE TABLE `secret_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`action` text NOT NULL,
	`secret_name` text,
	`secret_version_id` text,
	`actor_token_id` text,
	`outcome` text NOT NULL,
	`request_id` text
);
--> statement-breakpoint
CREATE INDEX `secret_audit_log_occurred_at_idx` ON `secret_audit_log` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `secret_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_name` text NOT NULL,
	`envelope` text NOT NULL,
	`kek_version` integer NOT NULL,
	`masked_prefix` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_at` text,
	FOREIGN KEY (`secret_name`) REFERENCES `secrets`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `secret_versions_name_created_idx` ON `secret_versions` (`secret_name`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `secret_versions_live_unique` ON `secret_versions` (`secret_name`) WHERE "secret_versions"."superseded_at" IS NULL;--> statement-breakpoint
CREATE TABLE `secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`rotated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope_prefix` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_name_unique` ON `service_tokens` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_token_hash_unique` ON `service_tokens` (`token_hash`);