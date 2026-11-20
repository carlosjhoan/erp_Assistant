ALTER TABLE `topic` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Orden inicial: el que ya tenían por fecha de creación dentro de cada estado.
UPDATE `topic` SET `position` = (
  SELECT COUNT(*) FROM `topic` t2
  WHERE t2.`status` = `topic`.`status` AND t2.`rowid` < `topic`.`rowid`
);
