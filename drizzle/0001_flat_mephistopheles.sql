CREATE TABLE `class_status` (
	`id` integer PRIMARY KEY NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`attendance` integer DEFAULT 0 NOT NULL,
	`absence` integer DEFAULT 0 NOT NULL,
	`early_dismissal` integer DEFAULT 0 NOT NULL,
	`tardy` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `academic_imports` ADD `kind` text DEFAULT 'calendar' NOT NULL;