CREATE TABLE `project_capability` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`stage` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`scope` text DEFAULT 'actual' NOT NULL,
	`integration` text DEFAULT 'I0' NOT NULL,
	`reliability` text DEFAULT 'F0' NOT NULL,
	`quality` text,
	`outside_rubric` integer DEFAULT false NOT NULL,
	`good` text,
	`improve` text,
	`evidence` text,
	`affected` text,
	`imported_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_project_key` ON `project_capability` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `capability_project` ON `project_capability` (`project_id`);