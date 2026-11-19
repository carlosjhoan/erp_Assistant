CREATE TABLE `project_repository` (
	`project_id` text NOT NULL,
	`repo_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `repo_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `repo`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `project` ADD `description` text;--> statement-breakpoint
ALTER TABLE `project` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
INSERT INTO `project_repository` (`project_id`, `repo_id`) SELECT `project_id`, `id` FROM `repo`;
