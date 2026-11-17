CREATE TABLE `llm_call` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`error_kind` text,
	`error_detail` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`prompt` text,
	`response` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `call_run` ON `llm_call` (`run_id`);--> statement-breakpoint
CREATE INDEX `call_created` ON `llm_call` (`created_at`);