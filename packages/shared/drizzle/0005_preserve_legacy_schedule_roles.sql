-- The verified legacy baseline writes this sidecar before immutable migration 0003
-- drops its member_roles column. Existing deployments without the sidecar take
-- the empty path; a current non-null snapshot is never overwritten.
CREATE TABLE IF NOT EXISTS `__wack_legacy_schedule_roles_v1` (
  `id` text PRIMARY KEY NOT NULL,
  `member_roles` text
);
--> statement-breakpoint
UPDATE `scheduled_tasks`
SET `member_roles` = (
  SELECT `backup`.`member_roles`
  FROM `__wack_legacy_schedule_roles_v1` AS `backup`
  WHERE `backup`.`id` = `scheduled_tasks`.`id`
)
WHERE `member_roles` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `__wack_legacy_schedule_roles_v1` AS `backup`
    WHERE `backup`.`id` = `scheduled_tasks`.`id`
  );
--> statement-breakpoint
DROP TABLE `__wack_legacy_schedule_roles_v1`;
