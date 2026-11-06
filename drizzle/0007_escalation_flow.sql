ALTER TABLE "ticket_escalations" ADD COLUMN "assigned_to_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD COLUMN "reopen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "ticket_escalations" SET "status" = 'open' WHERE "status" = 'approved' AND "kind" <> 'incident';--> statement-breakpoint
UPDATE "ticket_escalations" SET "resolved_at" = "updated_at" WHERE "status" = 'resolved' AND "resolved_at" IS NULL;
