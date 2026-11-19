ALTER TABLE `meeting` ADD `status` text DEFAULT 'imported' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting` ADD `project_id` text REFERENCES project(id);--> statement-breakpoint
-- Derivar el estado de lo que ya existe: con temas extraidos, y triaje cerrado si no queda ninguno propuesto.
UPDATE `meeting` SET `status` = CASE
  WHEN EXISTS (SELECT 1 FROM `topic` t WHERE t.`meeting_id` = `meeting`.`id`) THEN
    CASE WHEN EXISTS (SELECT 1 FROM `topic` t WHERE t.`meeting_id` = `meeting`.`id` AND t.`status` = 'proposed')
      THEN 'topics_extracted' ELSE 'triaged' END
  ELSE 'imported' END;
