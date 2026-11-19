-- El proyecto "General" fue una muleta de migración y no significa nada.
-- Lo que no pertenece a ningún proyecto es simplemente "sin proyecto".
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DELETE FROM `topic_project` WHERE `project_id` = (SELECT `id` FROM `project` WHERE `name` = 'General');--> statement-breakpoint
UPDATE `meeting` SET `project_id` = NULL WHERE `project_id` = (SELECT `id` FROM `project` WHERE `name` = 'General');--> statement-breakpoint
UPDATE `topic` SET `project_id` = NULL WHERE `project_id` = (SELECT `id` FROM `project` WHERE `name` = 'General');--> statement-breakpoint
DELETE FROM `project` WHERE `name` = 'General';--> statement-breakpoint
PRAGMA foreign_keys=ON;
