ALTER TABLE `agent_run` ADD `attempts` integer;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `error_kind` text;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `error_detail` text;