CREATE TABLE `created_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster` text NOT NULL,
	`role` text NOT NULL,
	`oid` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `created_roles_cluster_role` ON `created_roles` (`cluster`,`role`);