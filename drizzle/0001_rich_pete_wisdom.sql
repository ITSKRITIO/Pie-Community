CREATE TABLE `albums` (
	`id` int AUTO_INCREMENT NOT NULL,
	`creatorId` int NOT NULL,
	`title` varchar(120) NOT NULL,
	`description` varchar(240),
	`coverUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `albums_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`authorId` int NOT NULL,
	`title` varchar(140) NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`content` varchar(600) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`albumId` int NOT NULL,
	`uploaderId` int NOT NULL,
	`url` text NOT NULL,
	`fileKey` text NOT NULL,
	`caption` varchar(180),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `planParticipants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`planId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('going','not_going') NOT NULL DEFAULT 'going',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `planParticipants_id` PRIMARY KEY(`id`),
	CONSTRAINT `plan_participant_pair` UNIQUE(`planId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`creatorId` int NOT NULL,
	`title` varchar(120) NOT NULL,
	`description` text,
	`planDate` timestamp NOT NULL,
	`location` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(80) NOT NULL,
	`value` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `bio` varchar(240);--> statement-breakpoint
ALTER TABLE `users` ADD `lastSeenAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
ALTER TABLE `albums` ADD CONSTRAINT `albums_creatorId_users_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `photos` ADD CONSTRAINT `photos_albumId_albums_id_fk` FOREIGN KEY (`albumId`) REFERENCES `albums`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `photos` ADD CONSTRAINT `photos_uploaderId_users_id_fk` FOREIGN KEY (`uploaderId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `planParticipants` ADD CONSTRAINT `planParticipants_planId_plans_id_fk` FOREIGN KEY (`planId`) REFERENCES `plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `planParticipants` ADD CONSTRAINT `planParticipants_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plans` ADD CONSTRAINT `plans_creatorId_users_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `announcements_created_idx` ON `announcements` (`createdAt`);--> statement-breakpoint
CREATE INDEX `messages_user_idx` ON `messages` (`userId`);--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `participants_plan_idx` ON `planParticipants` (`planId`);--> statement-breakpoint
CREATE INDEX `plans_date_idx` ON `plans` (`planDate`);--> statement-breakpoint
CREATE INDEX `plans_creator_idx` ON `plans` (`creatorId`);--> statement-breakpoint
CREATE INDEX `users_username_idx` ON `users` (`username`);