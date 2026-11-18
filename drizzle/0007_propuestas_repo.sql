CREATE TABLE `topic_repo` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`papel` text NOT NULL,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`reason` text,
	`approach` text,
	`surfaces` text DEFAULT '[]' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`risks` text DEFAULT '[]' NOT NULL,
	`session_id` text,
	`model` text,
	`tokens` integer,
	`duration_ms` integer,
	`contaminated` integer DEFAULT false NOT NULL,
	`error` text,
	`approved_at` integer,
	`evaluated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `repo`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_repo_unique` ON `topic_repo` (`topic_id`,`repo_id`);--> statement-breakpoint
CREATE INDEX `topic_repo_status` ON `topic_repo` (`status`);