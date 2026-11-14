CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`tool` text NOT NULL,
	`input_hash` text,
	`output_ref` text,
	`tokens` integer,
	`cost` real,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `run_created` ON `agent_run` (`created_at`);--> statement-breakpoint
CREATE TABLE `item_event` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`source_person` text,
	`evidence_refs` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `rubric_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_item_created` ON `item_event` (`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `event_person` ON `item_event` (`source_person`);--> statement-breakpoint
CREATE TABLE `meeting` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`participants` text DEFAULT '[]' NOT NULL,
	`content_hash` text NOT NULL,
	`summary` text,
	`private_notes` text,
	`transcript` text,
	`summary_available` integer DEFAULT false NOT NULL,
	`private_notes_available` integer DEFAULT false NOT NULL,
	`transcript_available` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_source_external` ON `meeting` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `meeting_occurred` ON `meeting` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `recipient` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `report` (
	`id` text PRIMARY KEY NOT NULL,
	`template` text NOT NULL,
	`params` text NOT NULL,
	`content_md` text NOT NULL,
	`data_snapshot` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `report_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` integer,
	`error` text,
	FOREIGN KEY (`report_id`) REFERENCES `report`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `recipient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `delivery_report` ON `report_delivery` (`report_id`);--> statement-breakpoint
CREATE TABLE `rubric` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_at` integer,
	`approved_by` text,
	`parent_rubric_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`parent_rubric_id`) REFERENCES `rubric`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rubric_week_version` ON `rubric` (`week_start`,`version`);--> statement-breakpoint
CREATE INDEX `rubric_week_status` ON `rubric` (`week_start`,`status`);--> statement-breakpoint
CREATE TABLE `rubric_item` (
	`id` text PRIMARY KEY NOT NULL,
	`rubric_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`acceptance_criteria` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_date` text,
	`origin` text NOT NULL,
	`source_meeting_id` text,
	`source_excerpt` text,
	`carried_from_item_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`verify_status` text DEFAULT 'pending' NOT NULL,
	`verify_score` real,
	`verify_detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`rubric_id`) REFERENCES `rubric`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `item_rubric_type_status` ON `rubric_item` (`rubric_id`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `item_status` ON `rubric_item` (`status`);--> statement-breakpoint
CREATE TABLE `rubric_source_meeting` (
	`rubric_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	PRIMARY KEY(`rubric_id`, `meeting_id`),
	FOREIGN KEY (`rubric_id`) REFERENCES `rubric`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meeting_id`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE no action
);
