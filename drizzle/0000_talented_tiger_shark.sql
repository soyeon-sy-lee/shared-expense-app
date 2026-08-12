CREATE TABLE `monthly_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`expenses_json` text DEFAULT '[]' NOT NULL,
	`deposits_json` text DEFAULT '[]' NOT NULL,
	`card_filename` text DEFAULT '' NOT NULL,
	`bank_filename` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_imports_month_unique` ON `monthly_imports` (`month`);