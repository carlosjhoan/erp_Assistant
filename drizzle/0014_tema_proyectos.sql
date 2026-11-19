CREATE TABLE `topic_project` (
	`topic_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`topic_id`, `project_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Backfill: el proyecto unico que ya existia pasa a ser un vinculo.
INSERT INTO `topic_project` (`topic_id`, `project_id`)
SELECT `id`, `project_id` FROM `topic` WHERE `project_id` IS NOT NULL;
