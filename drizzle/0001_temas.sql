CREATE TABLE `topic` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text,
	`title` text NOT NULL,
	`description` text,
	`source_excerpt` text,
	`scope_signal` text,
	`scope_reason` text,
	`open_questions` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`origin` text NOT NULL,
	`rubric_id` text,
	`merged_into_topic_id` text,
	`decided_at` integer,
	`decided_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rubric_id`) REFERENCES `rubric`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_into_topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `topic_status` ON `topic` (`status`);--> statement-breakpoint
CREATE INDEX `topic_rubric` ON `topic` (`rubric_id`);--> statement-breakpoint
CREATE INDEX `topic_meeting` ON `topic` (`meeting_id`);--> statement-breakpoint
ALTER TABLE `rubric` ADD `deadline` text;--> statement-breakpoint
ALTER TABLE `rubric_item` ADD `topic_id` text REFERENCES topic(id);--> statement-breakpoint
ALTER TABLE `rubric_item` ADD `human_edited` integer DEFAULT false NOT NULL;