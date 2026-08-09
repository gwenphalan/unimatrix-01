ALTER TABLE `secret_audit_log` ADD `actor_kind` text NOT NULL;--> statement-breakpoint
ALTER TABLE `secret_audit_log` ADD `actor_user_id` text;--> statement-breakpoint
ALTER TABLE `secret_audit_log` ADD `service_token_id` text;--> statement-breakpoint
ALTER TABLE `service_tokens` ADD `capability` text NOT NULL;