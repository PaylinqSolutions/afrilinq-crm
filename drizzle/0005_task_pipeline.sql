ALTER TABLE "tasks" ADD COLUMN "stage" text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "task_type" text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "queue" text;--> statement-breakpoint
UPDATE "tasks" SET "stage" = 'completed' WHERE "status" = 'done';--> statement-breakpoint
UPDATE "tasks" SET "stage" = 'deferred' WHERE "status" = 'cancelled';--> statement-breakpoint
UPDATE "tasks" SET "task_type" = 'call', "title" = substr("title", 7) WHERE "title" LIKE 'Call: %';--> statement-breakpoint
UPDATE "tasks" SET "task_type" = 'email', "title" = substr("title", 8) WHERE "title" LIKE 'Email: %';
