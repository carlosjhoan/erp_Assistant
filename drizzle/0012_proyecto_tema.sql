ALTER TABLE `topic` ADD `project_id` text REFERENCES project(id);--> statement-breakpoint
ALTER TABLE `topic` ADD `context_source` text;--> statement-breakpoint
-- Backfill: lo existente va a un proyecto "General" que se crea acá si no está.
-- Es una muleta de migración: después se reasigna a mano desde la UI.
INSERT INTO `project` (`id`, `name`, `description`, `path`, `status`)
SELECT 'proj-general', 'General', 'Proyectos y temas previos al refactor multi-proyecto.', '.', 'active'
WHERE NOT EXISTS (SELECT 1 FROM `project` WHERE `name` = 'General')
  AND EXISTS (SELECT 1 FROM `topic` WHERE `project_id` IS NULL);
--> statement-breakpoint
UPDATE `topic` SET `project_id` = (SELECT `id` FROM `project` WHERE `name` = 'General') WHERE `project_id` IS NULL;
--> statement-breakpoint
UPDATE `meeting` SET `project_id` = (SELECT `id` FROM `project` WHERE `name` = 'General') WHERE `project_id` IS NULL;
