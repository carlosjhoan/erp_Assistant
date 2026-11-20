CREATE TABLE `project_diagnosis` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`business_pct` integer,
	`technical_pct` integer,
	`summary` text,
	`report_ref` text,
	`measured_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `diagnosis_project` ON `project_diagnosis` (`project_id`,`measured_at`);