ALTER TABLE `rubric_item` ADD `capability_id` text REFERENCES project_capability(id);--> statement-breakpoint
ALTER TABLE `rubric_item` ADD `capability_effect` text DEFAULT 'none' NOT NULL;