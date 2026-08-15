DROP INDEX `service_tokens_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_live_unique` ON `service_tokens` (`name`) WHERE "service_tokens"."revoked_at" IS NULL;