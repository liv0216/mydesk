CREATE TABLE `academic_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`r2_key` text NOT NULL,
	`detected_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`time` text,
	`location` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_import_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedule_events_date_idx` ON `schedule_events` (`date`);--> statement-breakpoint
CREATE TABLE `shortcuts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`tag` text DEFAULT '할 일' NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timetable_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` integer NOT NULL,
	`period` integer NOT NULL,
	`subject` text NOT NULL,
	`location` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timetable_day_period_idx` ON `timetable_entries` (`day`,`period`);